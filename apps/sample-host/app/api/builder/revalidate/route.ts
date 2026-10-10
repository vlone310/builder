import { createRevalidateHandler } from "@builder/next";

const secret = process.env.BUILDER_WEBHOOK_SECRET;

// The site's webhook points here; the worker signs every delivery.
export const { POST } = createRevalidateHandler({
  secret: secret ? secret.split(",") : [],
  onEvent: (event) =>
    console.log(
      `[builder] ${event.type} ${event.page?.slug ?? event.page?.name ?? event.tags.join(" ")}`,
    ),
});
