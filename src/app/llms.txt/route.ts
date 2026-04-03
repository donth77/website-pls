const BASE_URL = process.env.NEXT_PUBLIC_BASE_URL ?? "https://websitepls.com";

const LLMS_TXT = `# WebsitePls

> AI-powered website generator. Describe a website in plain language and get a fully built, responsive web page in seconds.

WebsitePls is a web application that uses AI (powered by Anthropic Claude) to generate complete, single-page websites from natural language descriptions. Users can iterate on the generated result through a conversational chat interface.

## Key Features

- **Instant generation**: Describe your website and get a complete HTML page with Tailwind CSS styling in under a minute.
- **Iterative refinement**: Edit your generated site by sending follow-up messages in the chat.
- **Real stock photos**: Images are sourced from Unsplash and Pexels with proper attribution.
- **Download & export**: Download the generated HTML or open it in a new tab.
- **Multilingual**: Available in 20 languages including English, Spanish, French, German, Japanese, Chinese, Arabic, and more.

## Pages

- [Home](${BASE_URL}): Main generator interface — enter a prompt and generate a website.
- [Login](${BASE_URL}/login): Sign in with email, Google, or GitHub.
- [Projects](${BASE_URL}/projects): View and manage saved projects (requires sign-in).

## Technical Details

- Built with Next.js, React, TypeScript, and Tailwind CSS.
- AI generation powered by Anthropic Claude.
- Image search via Unsplash and Pexels APIs.
- Background job processing with BullMQ and Redis.
- PostgreSQL database with Prisma ORM.
`;

export function GET() {
  return new Response(LLMS_TXT, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "public, max-age=86400, s-maxage=86400",
    },
  });
}
