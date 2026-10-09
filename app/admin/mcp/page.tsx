import { toolCatalogue } from "@/mcp/server.mjs";
import { AdminMcp } from "./admin-mcp";

export default function AdminMcpPage() {
  return <AdminMcp tools={toolCatalogue()} />;
}
