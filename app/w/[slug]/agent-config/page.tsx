import { redirect } from "next/navigation";

export default async function AgentConfigPage({
  params,
}: PageProps<"/w/[slug]/agent-config">) {
  const { slug } = await params;
  redirect(`/w/${slug}/agents?view=map`);
}
