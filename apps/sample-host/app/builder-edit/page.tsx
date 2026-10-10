import { EditTokenError, verifyEditToken } from "@builder/next";
import { builderConfig } from "@/builder/config";
import { HostEditCanvas } from "@/builder/edit-canvas";

export const dynamic = "force-dynamic";

type Props = { searchParams: Promise<{ token?: string }> };

export default async function EditPage({ searchParams }: Props) {
  const { token } = await searchParams;
  const config = builderConfig();
  try {
    if (!token) throw new EditTokenError("Missing edit token");
    await verifyEditToken(token, config);
  } catch (error) {
    if (!(error instanceof EditTokenError)) throw error;
    return (
      <section className="section section--md">
        <div className="container">
          <h1>Edit mode unavailable</h1>
          <p>{error.message}</p>
        </div>
      </section>
    );
  }
  return <HostEditCanvas editorOrigin={config.editorOrigin} editToken={token} />;
}
