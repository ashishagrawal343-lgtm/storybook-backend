====================================================================
MASTER CONTEXT & TECHNICAL ARCHITECTURE DOCUMENT
Project: Personalized AI Children's Storybook Generator ("TwinkleTale")
Status: READY FOR LAUNCH | Doc version: 2.0 | Updated: Sep 11, 2026
Purpose: Single source of truth. Feed this entire document to any AI
assistant to continue development without re-discovery.
====================================================================

--------------------------------------------------------------------
1. EXECUTIVE SUMMARY & TECH STACK OVERVIEW
--------------------------------------------------------------------
HOW THE APP WORKS (END-TO-END FLOW B: TEASER PREVIEW -> PAYMENT -> FULFILLMENT)
1) Parent visits website (TwinkleTale) and fills the customizer form:
   Child's Name, Child's Gender (Boy/Girl), Child's Age (1-10),
   Adventure Theme, optional child photo, personal dedication, parent email.
2) Frontend shrinks photo client-side to max 768px JPEG (base64 data-URI)
   and calls POST /api/create-preview.
3) Backend fast teaser (~35-40s):
   - DeepSeek (deepseek-chat) writes the book title, scene outline, and a 
     lyrical 4-line opening lullaby rhyme strictly honoring the child's gender.
   - Replicate generates (a) ornate cover background, (b) child vignette medallion 
     (using FLUX Kontext Pro if photo provided, else FLUX 1.1 Pro).
   - Backend caches session data under a unique previewId and returns the 
     personalized cover preview & opening rhyme.
4) Frontend smoothly scrolls to the Preview Stage displaying a 3D book mockup:
   Parent selects edition:
   - Treasury Edition (12 Interior Pages = 6 Spreads / 16 Total Pages): Rs. 199
   - Grand Treasury Edition (24 Interior Pages = 12 Spreads / 28 Total Pages): Rs. 299
5) Parent clicks "Unlock Full Book" -> Frontend calls POST /api/create-order.
   Razorpay checkout modal opens with UPI (GPay/PhonePe/Paytm), Cards, NetBanking.
   (Works in Test Mode immediately; switches to Live upon adding credentials).
6) Upon payment, frontend calls POST /api/verify-and-complete-book.
   Backend verifies HMAC-SHA256 signature, spawns asynchronous generation job,
   and returns jobId. Frontend polls GET /api/job-status/:jobId with live progress bar.
7) Backend compiles the locked Left-Image / Right-Verse Spread Layout:
   - Page 1: Front Cover (Gold-ring medallion + child vignette + curved title)
   - Page 2: Frontispiece / Welcome to TwinkleTale
   - Page 3: Dedication Page ("For ChildName" + personal note)
   - Pages 4 through (3 + 2 * scenes): Strict Left-Image / Right-Verse Spreads
     (Even Page = Left Full-Bleed Illustration; Odd Page = Right Framed Verse Page)
   - Penultimate Page: Keepsake Certificate ("This bedtime treasury belongs to ChildName")
   - Final Page: Back Cover (Theme palette + gold frame vectors + TwinkleTale seal)
8) PDF is uploaded to Supabase Storage (permanent public URL; local disk fallback).
   Brevo HTTPS API dispatches branded delivery email containing download link.
9) Frontend reveals big green "Download Storybook (PDF)" button.

FULL STACK TABLE
Layer              | Service/Tool          | Details
Frontend hosting   | GitHub Pages          | Repo jericho996/storybook, single index.html
Backend hosting    | Render.com            | Web Service storybook-backend, Node runtime, Free instance
Backend code repo  | GitHub                | ashishagrawal343-lgtm/storybook-backend, branch main
Story AI           | DeepSeek API          | Model deepseek-chat (~$0.001-0.002/book)
Image AI           | Replicate             | black-forest-labs/flux-1.1-pro and flux-kontext-pro
PDF engine         | pdf-lib (npm)         | Layout, typography, spread geometry, metadata
Permanent storage  | Supabase Storage      | Bucket storybooks (free 1 GB tier)
Email delivery     | Brevo (Sendinblue)    | HTTPS API POST /v3/smtp/email (free 300/day tier)
Payments           | Razorpay              | Order creation + HMAC-SHA256 verification (Test/Live)
Brand Name         | TwinkleTale           | "Every child is the hero of their own bedtime story"

--------------------------------------------------------------------
2. SPREAD ARCHITECTURE & DESIGN GUARANTEES
--------------------------------------------------------------------
PAGE COUNTS
- Short Book (Treasury Edition):
  12 Interior Pages = 6 Spreads (6 Left Images + 6 Right Verse Pages).
  Cover + Frontispiece + Dedication + 12 Interior + Keepsake + Back = 16 Pages.
  Price: Rs. 199. AI Cost: ~$0.28 (~Rs. 24). Gross Margin: ~87%.
- Long Book (Grand Treasury):
  24 Interior Pages = 12 Spreads (12 Left Images + 12 Right Verse Pages).
  Cover + Frontispiece + Dedication + 24 Interior + Keepsake + Back = 28 Pages.
  Price: Rs. 299. AI Cost: ~$0.44 (~Rs. 38). Gross Margin: ~86%.

SPREAD GEOMETRY (LEFT IMAGE, RIGHT TEXT)
- Page 1: Front Cover
- Page 2 (Left): Frontispiece / Welcome
- Page 3 (Right): Dedication Page
- Even Pages (4, 6, 8, ...): Left-side Full Bleed AI Illustration
- Odd Pages (5, 7, 9, ...): Right-side Cream Page with Decorative Border Frame,
  Centered Scene Title, Accent Diamond Motif, Centered Read-Aloud Rhyme, Spread Number
- Next Page (Left): Official Keepsake Certificate
- Final Page (Right): Back Cover

CHARACTER CONSISTENCY & GENDER LOCK
- Gender input: 'boy' or 'girl'.
- Character anchor: "a cute [age]-year-old [boy/girl] named [childName]".
- DeepSeek strictly enforced to use gender pronouns (he/him or she/her).
- Replicate prompt prefixes the character anchor into every scene illustration prompt.

--------------------------------------------------------------------
3. API ROUTES & CONTRACTS
--------------------------------------------------------------------
POST /api/create-preview
  Request:  { childName, gender, age, theme, photoData, dedication, email }
  Response: { success: true, previewId, childName, gender, age, bookTitle,
              openingRhyme, previewPdfUrl, vignetteUrl, coverBgUrl }

POST /api/create-order
  Request:  { previewId, bookLength, email }
  Response: { success: true, orderId, amount, currency: "INR", keyId, isTestMode }

POST /api/verify-and-complete-book
  Request:  { previewId, razorpay_order_id, razorpay_payment_id,
              razorpay_signature, bookLength, email }
  Response: { success: true, jobId }

GET /api/job-status/:jobId
  Response: { success: true, status: 'generating'|'completed'|'failed',
              progress: 0-100, step: string, pdfUrl, emailed, error }

POST /api/create-book (Direct generation / smoke test endpoint)
  Request:  { childName, gender, age, theme, photoData, bookLength, dedication, email }
  Response: { success: true, pdfUrl, emailed, elapsedSeconds }

GET /api/test-email?token=... (Email verification)
GET /books/<fileName>         (Static PDF local-fallback route)

--------------------------------------------------------------------
4. ENVIRONMENT VARIABLES
--------------------------------------------------------------------
Variable             | Purpose
DEEPSEEK_API_KEY     | Story generation
REPLICATE_API_TOKEN  | Image generation
SUPABASE_URL         | Supabase storage project URL
SUPABASE_SERVICE_KEY | Supabase storage service_role secret
BREVO_API_KEY        | Email delivery HTTPS API key
SENDER_EMAIL         | Verified Brevo sender email
RAZORPAY_KEY_ID      | Razorpay Key ID (rzp_test_... or rzp_live_...)
RAZORPAY_KEY_SECRET  | Razorpay Key Secret (server-side signature check)
EMAIL_TEST_TOKEN     | Gates /api/test-email
PORT                 | Auto 10000 on Render; 3000 locally
====================================================================