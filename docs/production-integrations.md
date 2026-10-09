# Production integrations

JoharHaat now uses Razorpay for UPI, S3/CloudFront for uploads and Resend for
email. SMS remains disabled until an India DLT-compatible provider is selected.

## Processes

Run the API with `pnpm start` and exactly one worker with `pnpm start:worker`.
Both use the same image and environment. The worker expires payment
reservations, reconciles background state, sends the email outbox and runs
analytics aggregation. Configure independent health/restart policies for both.

## Razorpay

Set `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET` and
`RAZORPAY_WEBHOOK_SECRET` on the API only. The browser receives the public key
ID and a server-created Razorpay order through `POST /api/v1/payments/intents`;
it sends the Checkout order ID, payment ID and signature to
`POST /api/v1/payments/intents/:id/verify`. The API verifies the signature and
fetches the payment from Razorpay before marking the order paid. Do not add a
client-supplied success/failure confirmation path.

The storefront launches Razorpay Standard Checkout with UPI as its only visible
method. Keep UPI enabled and all other methods disabled in the Razorpay
Dashboard as a second guard. Register
`POST /api/v1/payments/razorpay/webhook` for `payment.captured` and
`payment.failed`; configure auto-capture. Use Razorpay test-mode keys in local
development/staging, then replace them with live-mode credentials and complete
a live end-to-end acceptance payment before production traffic. Razorpay test
mode is a gateway test transaction, not a real customer charge.

## GST and checkout amounts

Product prices shown to customers include GST. Configure each product's HSN
code and GST rate in **Admin → Product tax** after verifying its classification;
checkout refuses a product whose classification is still missing. Rates and
the computed taxable value and tax components are snapshotted on each order
item so later catalog edits do not alter existing orders or invoices.

Set `GST_REGISTRATION_STATE` to the supplier's registered state. The customer's
saved address state determines whether product tax is split into CGST/SGST or
charged as IGST. Set `DELIVERY_GST_RATE` only after confirming how the courier
charge is invoiced; this rate is applied separately to the delivery fee and
added to the customer total. The example defaults to zero and must be reviewed
with the marketplace's tax advisor before production. Historical orders retain
their stored amounts and are not recalculated.

## Delivery coverage and fees

Checkout uses the destination PIN's configured courier fee, with the editable
free-delivery threshold applied to the merchandise subtotal after coupons and
before tax. Import and review the courier coverage CSV under **Admin → Settings
→ Delivery coverage & fees**, then enable PIN pricing. Until rates are enabled,
checkout marks delivery unavailable and does not apply a universal fallback
charge. Unknown or non-serviceable PINs are rejected; do not enable the policy
until the courier file has been reviewed.

## S3 and CloudFront

Use a private bucket with Block Public Access, bucket-owner-enforced ownership,
default encryption and a CloudFront Origin Access Control. Grant the API role
only `s3:PutObject`, `s3:GetObject`, `s3:HeadObject` and
`s3:PutObjectTagging` for `public/*` and `private/msme/*`. CloudFront may read
only `public/*`.

Bucket CORS must allow the exact website origins, `PUT`, and these headers:
`Content-Type`, `x-amz-meta-category`, `x-amz-meta-expectedsize`, `x-amz-meta-ownerid`,
`x-amz-server-side-encryption`, `x-amz-tagging`. Do not use wildcard origins
with credentials. For the current local and production sites, apply this rule
in the S3 bucket's Permissions → CORS editor using an AWS principal with
`s3:PutBucketCORS`:

```json
[
  {
    "AllowedOrigins": [
      "http://localhost:3000",
      "https://joharhaat-jharkhand.joharxp.chatgpt.site"
    ],
    "AllowedMethods": ["PUT"],
    "AllowedHeaders": [
      "Content-Type",
      "x-amz-meta-category",
      "x-amz-meta-expectedsize",
      "x-amz-meta-ownerid",
      "x-amz-server-side-encryption",
      "x-amz-tagging"
    ],
    "ExposeHeaders": ["ETag"],
    "MaxAgeSeconds": 3000
  }
]
```

Add a lifecycle rule that expires objects tagged
`confirmed=false`; confirmed business objects are retagged to `true` by the
API.

## Resend

Verify the sending domain, then set `RESEND_API_KEY`,
`RESEND_WEBHOOK_SECRET`, `EMAIL_FROM`, `EMAIL_REPLY_TO` and
`FRONTEND_BASE_URL`. Register `POST /api/v1/webhooks/resend` for bounce and
complaint events. Outbox retries are idempotent and terminal after five failed
attempts.
