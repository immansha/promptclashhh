import { redirect } from "next/navigation";

export default async function LegacyRoomRedirect({
  params,
}: {
  params: Promise<{ code: string }>;
}) {
  const { code } = await params;
  redirect(`/room/${encodeURIComponent(code)}`);
}
