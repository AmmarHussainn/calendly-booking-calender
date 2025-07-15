
const axios = require('axios');
const { parseNaturalDate, validateFutureDate } = require('./utils/dateParser');
require('dotenv').config();

class CalendlyService {
  constructor(accessToken) {
    this.client = axios.create({
      baseURL: 'https://api.calendly.com',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json'
      }
    });
  }

async getAvailability(eventTypeUri, dateInput, timezone = 'UTC') {
    let startTime;
    
    try {
      // Handle both natural language and ISO dates
      const parsedDate = typeof dateInput === 'string' 
        ? parseNaturalDate(dateInput, timezone)
        : { iso: new Date(dateInput).toISOString() };
      
      startTime = validateFutureDate(new Date(parsedDate.iso)).toISOString();
    } catch (error) {
      throw new Error(`Invalid date: ${error.message}`);
    }

    const endTime = new Date(new Date(startTime).getTime() + 7 * 24 * 60 * 60 * 1000).toISOString();

    const response = await this.client.get('/event_type_available_times', {
      params: {
        event_type: eventTypeUri,
        start_time: startTime,
        end_time: endTime,
        timezone: timezone
      }
    });
    return response.data.collection;
  }

  // Direct booking with webhook registration
  async bookAppointment(eventTypeUri, invitee, timezone = 'UTC') {
    const eventUuid = eventTypeUri.split('/').pop();
    
    // 1. Create scheduling link
    const { data: { resource: schedulingLink } } = await this.client.post('/scheduling_links', {
      max_event_count: 1,
      owner: eventTypeUri,
      owner_type: 'EventType'
    });

    // 2. Register webhook for confirmation
    await this.registerWebhook(eventUuid, invitee.email);
    
    return {
      booking_url: schedulingLink.booking_url,
      confirmation_required: true
    };
  }

  // Webhook registration with signature verification
  async registerWebhook(eventUuid, email) {
    await this.client.post('/webhook_subscriptions', {
      url: `${process.env.BASE_URL}/webhooks/confirmations`,
      events: ['invitee.created'],
      scope: 'user',
      organization: "https://api.calendly.com/organizations/83f76f79-af59-4f64-9ce7-d6f78ff862a9",
      user: "https://api.calendly.com/users/471265af-302d-42f8-971c-9a37cbd68753",
      signing_key: process.env.CALENDLY_WEBHOOK_SIGNING_KEY,
      // metadata: { eventUuid, email }
    });
  }

  // Email template customization
  async setEmailTemplate(eventTypeUri, templateConfig) {
    const eventUuid = eventTypeUri.split('/').pop();
    return this.client.patch(`/event_types/${eventUuid}`, {
      email_template: {
        subject: templateConfig.subject,
        body: templateConfig.body
      }
    });
  }

  // Waiting list management
  async addToWaitlist(eventTypeUri, userData) {
    const eventUuid = eventTypeUri.split('/').pop();
    return this.client.post(`/event_types/${eventUuid}/waitlist`, userData);
  }
}

module.exports = CalendlyService;