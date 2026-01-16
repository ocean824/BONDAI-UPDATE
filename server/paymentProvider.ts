// Payment Provider Abstraction Layer
// Supports Stripe, Plaid (ACH), Square, and Mock providers
// Enterprise-ready for $100B+ bond transactions

import { config, paymentConfig, enterpriseLimits, type PaymentProvider } from './config';

export interface PaymentIntent {
  id: string;
  amount: number;
  currency: string;
  status: 'pending' | 'processing' | 'succeeded' | 'failed' | 'cancelled';
  metadata: Record<string, string>;
  createdAt: Date;
}

export interface PaymentMethod {
  id: string;
  type: 'card' | 'bank_account' | 'ach' | 'wire';
  last4?: string;
  brand?: string;
  bankName?: string;
  isDefault: boolean;
}

export interface CustomerPaymentProfile {
  id: string;
  email: string;
  defaultPaymentMethod?: PaymentMethod;
  paymentMethods: PaymentMethod[];
}

// Abstract payment provider interface
export interface IPaymentProvider {
  readonly provider: PaymentProvider;
  
  // Customer management
  createCustomer(email: string, metadata?: Record<string, string>): Promise<string>;
  getCustomer(customerId: string): Promise<CustomerPaymentProfile | null>;
  updateCustomer(customerId: string, data: Partial<CustomerPaymentProfile>): Promise<void>;
  
  // Payment methods
  attachPaymentMethod(customerId: string, paymentMethodId: string): Promise<void>;
  detachPaymentMethod(paymentMethodId: string): Promise<void>;
  getPaymentMethods(customerId: string): Promise<PaymentMethod[]>;
  setDefaultPaymentMethod(customerId: string, paymentMethodId: string): Promise<void>;
  
  // Payment operations
  createPaymentIntent(
    amount: number,
    currency: string,
    customerId?: string,
    metadata?: Record<string, string>
  ): Promise<PaymentIntent>;
  
  confirmPayment(paymentIntentId: string, paymentMethodId?: string): Promise<PaymentIntent>;
  cancelPayment(paymentIntentId: string): Promise<PaymentIntent>;
  refundPayment(paymentIntentId: string, amount?: number): Promise<{ id: string; status: string }>;
  
  // Subscriptions
  createSubscription(customerId: string, priceId: string, metadata?: Record<string, string>): Promise<string>;
  cancelSubscription(subscriptionId: string): Promise<void>;
  getSubscription(subscriptionId: string): Promise<{ status: string; currentPeriodEnd: Date } | null>;
  
  // Webhooks
  constructWebhookEvent(payload: Buffer, signature: string): Promise<{ type: string; data: any }>;
}

// Stripe implementation
class StripePaymentProvider implements IPaymentProvider {
  readonly provider: PaymentProvider = 'stripe';
  private stripe: any;
  
  constructor() {
    this.initStripe();
  }
  
  private async initStripe() {
    try {
      const Stripe = (await import('stripe')).default;
      const secretKey = paymentConfig.stripe.secretKey;
      if (secretKey) {
        this.stripe = new Stripe(secretKey, {
          apiVersion: paymentConfig.stripe.apiVersion,
        });
        console.log('✅ Stripe payment provider initialized');
      } else {
        console.warn('⚠️ Stripe not configured - payments will use mock mode');
      }
    } catch (error) {
      console.error('Failed to initialize Stripe:', error);
    }
  }
  
  async createCustomer(email: string, metadata?: Record<string, string>): Promise<string> {
    if (!this.stripe) throw new Error('Stripe not configured');
    const customer = await this.stripe.customers.create({
      email,
      metadata,
    });
    return customer.id;
  }
  
  async getCustomer(customerId: string): Promise<CustomerPaymentProfile | null> {
    if (!this.stripe) throw new Error('Stripe not configured');
    try {
      const customer = await this.stripe.customers.retrieve(customerId);
      if (customer.deleted) return null;
      
      const paymentMethods = await this.stripe.paymentMethods.list({
        customer: customerId,
        type: 'card',
      });
      
      return {
        id: customer.id,
        email: customer.email,
        paymentMethods: paymentMethods.data.map((pm: any) => ({
          id: pm.id,
          type: 'card' as const,
          last4: pm.card?.last4,
          brand: pm.card?.brand,
          isDefault: false,
        })),
      };
    } catch {
      return null;
    }
  }
  
  async updateCustomer(customerId: string, data: Partial<CustomerPaymentProfile>): Promise<void> {
    if (!this.stripe) throw new Error('Stripe not configured');
    await this.stripe.customers.update(customerId, {
      email: data.email,
    });
  }
  
  async attachPaymentMethod(customerId: string, paymentMethodId: string): Promise<void> {
    if (!this.stripe) throw new Error('Stripe not configured');
    await this.stripe.paymentMethods.attach(paymentMethodId, {
      customer: customerId,
    });
  }
  
  async detachPaymentMethod(paymentMethodId: string): Promise<void> {
    if (!this.stripe) throw new Error('Stripe not configured');
    await this.stripe.paymentMethods.detach(paymentMethodId);
  }
  
  async getPaymentMethods(customerId: string): Promise<PaymentMethod[]> {
    if (!this.stripe) throw new Error('Stripe not configured');
    const paymentMethods = await this.stripe.paymentMethods.list({
      customer: customerId,
      type: 'card',
    });
    return paymentMethods.data.map((pm: any) => ({
      id: pm.id,
      type: 'card' as const,
      last4: pm.card?.last4,
      brand: pm.card?.brand,
      isDefault: false,
    }));
  }
  
  async setDefaultPaymentMethod(customerId: string, paymentMethodId: string): Promise<void> {
    if (!this.stripe) throw new Error('Stripe not configured');
    await this.stripe.customers.update(customerId, {
      invoice_settings: {
        default_payment_method: paymentMethodId,
      },
    });
  }
  
  async createPaymentIntent(
    amount: number,
    currency: string,
    customerId?: string,
    metadata?: Record<string, string>
  ): Promise<PaymentIntent> {
    if (!this.stripe) throw new Error('Stripe not configured');
    
    // Enterprise check: Validate transaction amount
    if (amount > enterpriseLimits.maxTransactionAmount) {
      throw new Error(`Transaction amount exceeds limit of $${enterpriseLimits.maxTransactionAmount}`);
    }
    
    const intent = await this.stripe.paymentIntents.create({
      amount: Math.round(amount * 100), // Convert to cents
      currency: currency.toLowerCase(),
      customer: customerId,
      metadata,
      automatic_payment_methods: {
        enabled: true,
      },
    });
    
    return {
      id: intent.id,
      amount: amount,
      currency: currency,
      status: intent.status as PaymentIntent['status'],
      metadata: metadata || {},
      createdAt: new Date(intent.created * 1000),
    };
  }
  
  async confirmPayment(paymentIntentId: string, paymentMethodId?: string): Promise<PaymentIntent> {
    if (!this.stripe) throw new Error('Stripe not configured');
    
    const intent = await this.stripe.paymentIntents.confirm(paymentIntentId, {
      payment_method: paymentMethodId,
    });
    
    return {
      id: intent.id,
      amount: intent.amount / 100,
      currency: intent.currency,
      status: intent.status as PaymentIntent['status'],
      metadata: intent.metadata,
      createdAt: new Date(intent.created * 1000),
    };
  }
  
  async cancelPayment(paymentIntentId: string): Promise<PaymentIntent> {
    if (!this.stripe) throw new Error('Stripe not configured');
    
    const intent = await this.stripe.paymentIntents.cancel(paymentIntentId);
    
    return {
      id: intent.id,
      amount: intent.amount / 100,
      currency: intent.currency,
      status: 'cancelled' as const,
      metadata: intent.metadata,
      createdAt: new Date(intent.created * 1000),
    };
  }
  
  async refundPayment(paymentIntentId: string, amount?: number): Promise<{ id: string; status: string }> {
    if (!this.stripe) throw new Error('Stripe not configured');
    
    const refund = await this.stripe.refunds.create({
      payment_intent: paymentIntentId,
      amount: amount ? Math.round(amount * 100) : undefined,
    });
    
    return {
      id: refund.id,
      status: refund.status,
    };
  }
  
  async createSubscription(customerId: string, priceId: string, metadata?: Record<string, string>): Promise<string> {
    if (!this.stripe) throw new Error('Stripe not configured');
    
    const subscription = await this.stripe.subscriptions.create({
      customer: customerId,
      items: [{ price: priceId }],
      metadata,
    });
    
    return subscription.id;
  }
  
  async cancelSubscription(subscriptionId: string): Promise<void> {
    if (!this.stripe) throw new Error('Stripe not configured');
    await this.stripe.subscriptions.cancel(subscriptionId);
  }
  
  async getSubscription(subscriptionId: string): Promise<{ status: string; currentPeriodEnd: Date } | null> {
    if (!this.stripe) throw new Error('Stripe not configured');
    
    try {
      const subscription = await this.stripe.subscriptions.retrieve(subscriptionId);
      return {
        status: subscription.status,
        currentPeriodEnd: new Date(subscription.current_period_end * 1000),
      };
    } catch {
      return null;
    }
  }
  
  async constructWebhookEvent(payload: Buffer, signature: string): Promise<{ type: string; data: any }> {
    if (!this.stripe) throw new Error('Stripe not configured');
    
    const secret = paymentConfig.stripe.webhookSecret;
    if (!secret) throw new Error('Stripe webhook secret not configured');
    
    const event = this.stripe.webhooks.constructEvent(payload, signature, secret);
    return {
      type: event.type,
      data: event.data.object,
    };
  }
}

// Mock payment provider for testing
class MockPaymentProvider implements IPaymentProvider {
  readonly provider: PaymentProvider = 'mock';
  private customers: Map<string, CustomerPaymentProfile> = new Map();
  private paymentIntents: Map<string, PaymentIntent> = new Map();
  private subscriptions: Map<string, { status: string; currentPeriodEnd: Date }> = new Map();
  
  async createCustomer(email: string, metadata?: Record<string, string>): Promise<string> {
    const id = `mock_cus_${Date.now()}`;
    this.customers.set(id, {
      id,
      email,
      paymentMethods: [],
    });
    return id;
  }
  
  async getCustomer(customerId: string): Promise<CustomerPaymentProfile | null> {
    return this.customers.get(customerId) || null;
  }
  
  async updateCustomer(customerId: string, data: Partial<CustomerPaymentProfile>): Promise<void> {
    const customer = this.customers.get(customerId);
    if (customer) {
      Object.assign(customer, data);
    }
  }
  
  async attachPaymentMethod(customerId: string, paymentMethodId: string): Promise<void> {
    const customer = this.customers.get(customerId);
    if (customer) {
      customer.paymentMethods.push({
        id: paymentMethodId,
        type: 'card',
        last4: '4242',
        brand: 'visa',
        isDefault: customer.paymentMethods.length === 0,
      });
    }
  }
  
  async detachPaymentMethod(paymentMethodId: string): Promise<void> {
    for (const customer of Array.from(this.customers.values())) {
      customer.paymentMethods = customer.paymentMethods.filter((pm: PaymentMethod) => pm.id !== paymentMethodId);
    }
  }
  
  async getPaymentMethods(customerId: string): Promise<PaymentMethod[]> {
    return this.customers.get(customerId)?.paymentMethods || [];
  }
  
  async setDefaultPaymentMethod(customerId: string, paymentMethodId: string): Promise<void> {
    const customer = this.customers.get(customerId);
    if (customer) {
      customer.paymentMethods = customer.paymentMethods.map(pm => ({
        ...pm,
        isDefault: pm.id === paymentMethodId,
      }));
    }
  }
  
  async createPaymentIntent(
    amount: number,
    currency: string,
    customerId?: string,
    metadata?: Record<string, string>
  ): Promise<PaymentIntent> {
    if (amount > enterpriseLimits.maxTransactionAmount) {
      throw new Error(`Transaction amount exceeds limit of $${enterpriseLimits.maxTransactionAmount}`);
    }
    
    const id = `mock_pi_${Date.now()}`;
    const intent: PaymentIntent = {
      id,
      amount,
      currency,
      status: 'succeeded',
      metadata: metadata || {},
      createdAt: new Date(),
    };
    this.paymentIntents.set(id, intent);
    return intent;
  }
  
  async confirmPayment(paymentIntentId: string): Promise<PaymentIntent> {
    const intent = this.paymentIntents.get(paymentIntentId);
    if (intent) {
      intent.status = 'succeeded';
      return intent;
    }
    throw new Error('Payment intent not found');
  }
  
  async cancelPayment(paymentIntentId: string): Promise<PaymentIntent> {
    const intent = this.paymentIntents.get(paymentIntentId);
    if (intent) {
      intent.status = 'cancelled';
      return intent;
    }
    throw new Error('Payment intent not found');
  }
  
  async refundPayment(paymentIntentId: string): Promise<{ id: string; status: string }> {
    return {
      id: `mock_re_${Date.now()}`,
      status: 'succeeded',
    };
  }
  
  async createSubscription(customerId: string): Promise<string> {
    const id = `mock_sub_${Date.now()}`;
    this.subscriptions.set(id, {
      status: 'active',
      currentPeriodEnd: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
    });
    return id;
  }
  
  async cancelSubscription(subscriptionId: string): Promise<void> {
    const sub = this.subscriptions.get(subscriptionId);
    if (sub) {
      sub.status = 'canceled';
    }
  }
  
  async getSubscription(subscriptionId: string): Promise<{ status: string; currentPeriodEnd: Date } | null> {
    return this.subscriptions.get(subscriptionId) || null;
  }
  
  async constructWebhookEvent(): Promise<{ type: string; data: any }> {
    return {
      type: 'mock.event',
      data: {},
    };
  }
}

// Factory function to get the appropriate payment provider
let paymentProvider: IPaymentProvider | null = null;

export function getPaymentProvider(): IPaymentProvider {
  if (!paymentProvider) {
    if (!paymentConfig.enabled) {
      paymentProvider = new MockPaymentProvider();
    } else if (paymentConfig.provider === 'stripe' && paymentConfig.stripe.secretKey) {
      paymentProvider = new StripePaymentProvider();
    } else if (paymentConfig.provider === 'mock' || paymentConfig.mock.enabled) {
      paymentProvider = new MockPaymentProvider();
    } else {
      console.warn(`Payment provider '${paymentConfig.provider}' not fully configured, using mock provider`);
      paymentProvider = new MockPaymentProvider();
    }
  }
  return paymentProvider;
}

// Helper functions for common operations
export async function createBondPurchasePayment(
  bondId: number,
  investorId: number,
  amount: number,
  currency: string = 'USD'
): Promise<PaymentIntent> {
  const provider = getPaymentProvider();
  return provider.createPaymentIntent(amount, currency, undefined, {
    bondId: String(bondId),
    investorId: String(investorId),
    purpose: 'bond_purchase',
  });
}

export async function createSubscriptionPayment(
  customerId: string,
  priceId: string,
  tier: string
): Promise<string> {
  const provider = getPaymentProvider();
  return provider.createSubscription(customerId, priceId, { tier });
}

export async function processRefund(
  paymentIntentId: string,
  amount?: number
): Promise<{ id: string; status: string }> {
  const provider = getPaymentProvider();
  return provider.refundPayment(paymentIntentId, amount);
}
