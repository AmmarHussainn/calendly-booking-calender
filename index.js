require('dotenv').config();
const express = require('express');
const bodyParser = require('body-parser');
const crypto = require('crypto');
const axios = require('axios');
const CalendlyService = require('./calendlyService');
const { parseNaturalDate } = require('./utils/dateParser');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(bodyParser.json());
app.use(express.static('public'));

// Memory store (use Redis in production)
const storage = {
  tokens: {},
  waitlists: new Map(),
  webhooks: new Map()
};

// 1. Authentication Endpoints
app.get('/auth/calendly', (req, res) => {
  const redirectUri = `${process.env.BASE_URL}/auth/callback`;
  const authUrl = `https://auth.calendly.com/oauth/authorize?client_id=${process.env.CALENDLY_CLIENT_ID}&response_type=code&redirect_uri=${encodeURIComponent(redirectUri)}`;
  res.redirect(authUrl);
});

app.get('/auth/callback', async (req, res) => {
  try {
    const { code } = req.query;
    const { data } = await axios.post('https://auth.calendly.com/oauth/token', {
      client_id: process.env.CALENDLY_CLIENT_ID,
      client_secret: process.env.CALENDLY_CLIENT_SECRET,
      code,
      grant_type: 'authorization_code',
      redirect_uri: `${process.env.BASE_URL}/auth/callback`
    });

    storage.tokens.accessToken = data.access_token;
    res.json({ status: 'authenticated', expires_in: data.expires_in });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});



app.post('/api/book', async (req, res) => {
  try {
    const { eventTypeUri, user, timezone = 'UTC', preferredTime } = req.body;
    const calendly = new CalendlyService(storage.tokens.accessToken);

    let availability;
    let parsedPreferred;
    
    if (preferredTime) {
      try {
        // Parse with proper timezone handling
        parsedPreferred = parseNaturalDate(preferredTime, timezone);
        
        // Get availability starting from the parsed time
        availability = await calendly.getAvailability(
          eventTypeUri, 
          parsedPreferred.iso, 
          timezone
        );

        // Find matching slot (30-minute window)
        const matchingSlot = availability.find(slot => {
          const slotTime = new Date(slot.start_time).getTime();
          const preferredTime = new Date(parsedPreferred.iso).getTime();
          return Math.abs(slotTime - preferredTime) < 30 * 60 * 1000;
        });

        if (!matchingSlot) {
          return res.status(400).json({
            status: 'time_unavailable',
            message: 'Your preferred time is not available',
            requested_time: format(new Date(parsedPreferred.iso), 'MMM d, yyyy, h:mm a', {
              timeZone: timezone
            }),
            available_slots: availability.map(slot => ({
              date: format(new Date(slot.start_time), 'MMM d, yyyy', { timeZone: timezone }),
              time: format(new Date(slot.start_time), 'h:mm a', { timeZone: timezone }),
              iso: slot.start_time,
              timezone
            }))
          });
        }

        // If we found a matching slot, proceed with booking
        const booking = await calendly.bookAppointment(
          eventTypeUri, 
          user, 
          timezone
        );
        
        return res.json({
          status: 'confirmation_required',
          booking_url: booking.booking_url,
          confirmed_time: {
            formatted: format(new Date(parsedPreferred.iso), 'MMM d, yyyy, h:mm a', {
              timeZone: timezone
            }),
            iso: parsedPreferred.iso,
            timezone
          },
          expires_at: new Date(Date.now() + 30 * 60 * 1000).toISOString()
        });

      } catch (parseError) {
        return res.status(400).json({
          error: parseError.message,
          details: 'Please provide a valid future date/time like "July 15 7am" or "tomorrow 2pm"'
        });
      }
    }

    // Default flow when no preferredTime is specified
    availability = await calendly.getAvailability(
      eventTypeUri, 
      'tomorrow 9am', 
      timezone
    );

    if (availability.length === 0) {
      const waitlistResult = await calendly.addToWaitlist(eventTypeUri, user);
      return res.json({
        status: 'waitlist',
        message: 'No available slots. You\'ve been added to our waitlist.',
        waitlist_id: waitlistResult.data.id,
        next_check_date: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()
      });
    }

    const booking = await calendly.bookAppointment(
      eventTypeUri, 
      user, 
      timezone
    );
    
    res.json({
      status: 'confirmation_required',
      booking_url: booking.booking_url,
      available_slots: availability.map(slot => ({
        date: format(new Date(slot.start_time), 'MMM d, yyyy', { timeZone: timezone }),
        time: format(new Date(slot.start_time), 'h:mm a', { timeZone: timezone }),
        iso: slot.start_time,
        timezone
      })),
      expires_at: new Date(Date.now() + 30 * 60 * 1000).toISOString()
    });

  } catch (error) {
    console.error('Booking error:', error);
    res.status(500).json({
      error: error.message,
      details: error.response?.data || null
    });
  }
});
// 3. Webhook Handling
app.post('/webhooks/confirmations', (req, res) => {
  try {
    // Verify signature
    const signature = req.headers['x-calendly-webhook-signature'];
    const expectedSignature = crypto
      .createHmac('sha256', process.env.CALENDLY_WEBHOOK_SIGNING_KEY)
      .update(JSON.stringify(req.body))
      .digest('hex');

    if (signature !== expectedSignature) {
      throw new Error('Invalid signature');
    }

    // Process confirmed booking
    const { event, payload } = req.body;
    if (event === 'invitee.created') {
      console.log('Booking confirmed:', payload);
      // Trigger confirmation email or other actions
    }

    res.status(200).send('Webhook processed');
  } catch (error) {
    console.error('Webhook error:', error);
    res.status(403).send('Unauthorized');
  }
});

// 4. Admin Endpoints
app.post('/api/email-templates', async (req, res) => {
  try {
    const calendly = new CalendlyService(storage.tokens.accessToken);
    const result = await calendly.setEmailTemplate(
      req.body.eventTypeUri,
      {
        subject: req.body.subject,
        body: req.body.template
      }
    );
    res.json(result.data);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/waitlist/:eventType', async (req, res) => {
  try {
    const waitlist = storage.waitlists.get(req.params.eventType) || [];
    res.json(waitlist);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`Webhook URL: ${process.env.BASE_URL}/webhooks/confirmations`);
});