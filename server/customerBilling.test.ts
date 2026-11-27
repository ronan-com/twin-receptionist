import { expect, test } from "bun:test";
import {cleanCustomerBilling} from "./customerBilling";
const valid={monthlyCents:19900,currency:"AUD",checkoutUrl:"https://buy.stripe.com/test_example",status:"not_started" as const};
test("customer billing accepts an agency's Stripe checkout link",()=>expect(cleanCustomerBilling(valid)).toEqual(valid));
test("billing rejects invalid prices, payment hosts and unrecognised status",()=>{
 for(const input of [{...valid,monthlyCents:0},{...valid,monthlyCents:1.2},{...valid,currency:"XXX"},{...valid,status:"paid"},{...valid,checkoutUrl:"https://example.com/pay"},{...valid,checkoutUrl:"http://buy.stripe.com/abc"}]) expect(()=>cleanCustomerBilling(input)).toThrow();
});
