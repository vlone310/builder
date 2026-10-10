import { PageRenderer } from "@builder/react";
import type { Metadata } from "next";
import { draftMode } from "next/headers";
import { notFound } from "next/navigation";
import { dataServices } from "@/builder/data";
import { registry } from "@/builder/registry";
import { fetchPage, locale } from "@/lib/builder";

// A safety net only: publishing revalidates pages on demand through the webhook.
export const revalidate = 3600;

// No pages at build time; each is rendered on first request, then cached (ISR).
export async function generateStaticParams() {
  return [];
}

type Props = { params: Promise<{ slug?: string[] }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const page = await fetchPage((await params).slug);
  const seo = page?.page.seo;
  return {
    ...(seo?.title ? { title: seo.title } : {}),
    ...(seo?.description ? { description: seo.description } : {}),
    ...(seo?.canonical ? { alternates: { canonical: seo.canonical } } : {}),
    ...(seo?.noindex ? { robots: { index: false } } : {}),
  };
}

export default async function Page({ params }: Props) {
  const page = await fetchPage((await params).slug);
  if (!page) notFound();
  const previewing = "preview" in page;
  return (
    <>
      {previewing && (await draftMode()).isEnabled && (
        <div className="preview-bar" role="status">
          Previewing an unpublished draft.{" "}
          <a href={`/api/builder/preview?exit=1&slug=${encodeURIComponent(page.page.slug ?? "/")}`}>
            Exit preview
          </a>
        </div>
      )}
      <PageRenderer page={page} registry={registry} ctx={{ data: dataServices, locale }} />
    </>
  );
}
