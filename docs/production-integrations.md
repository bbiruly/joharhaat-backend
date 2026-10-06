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
`RAZORPAY_WEBHOOK_SECRET`. Register
`POST /api/v1/payments/razorpay/webhook` for `payment.captured` and
`payment.failed`. Only UPI is enabled in this release; disable other methods in
the Razorpay dashboard as a second guard. Use auto-capture and test-mode keys in
staging.

## S3 and CloudFront

Use a private bucket with Block Public Access, bucket-owner-enforced ownership,
default encryption and a CloudFront Origin Access Control. Grant the API role
only `s3:PutObject`, `s3:GetObject`, `s3:HeadObject` and
`s3:PutObjectTagging` for `public/*` and `private/msme/*`. CloudFront may read
only `public/*`.

Bucket CORS must allow the exact website origins, `PUT`, and these headers:
`Content-Type`, `x-amz-meta-category`, `x-amz-meta-expectedsize`, `x-amz-meta-ownerid`,
`x-amz-server-side-encryption`, `x-amz-tagging`. Do not use wildcard origins
with credentials. Add a lifecycle rule that expires objects tagged
`confirmed=false`; confirmed business objects are retagged to `true` by the
API.

## Resend

Verify the sending domain, then set `RESEND_API_KEY`,
`RESEND_WEBHOOK_SECRET`, `EMAIL_FROM`, `EMAIL_REPLY_TO` and
`FRONTEND_BASE_URL`. Register `POST /api/v1/webhooks/resend` for bounce and
complaint events. Outbox retries are idempotent and terminal after five failed
attempts.
