import { getDatabase } from "@/server/database";
import { version } from "../../../../package.json";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export function GET() {
  try {
    getDatabase().prepare("SELECT 1").get();
    return Response.json({status:"ok",database:"connected",app:"vk-automobiles",version,instance:process.env.SHOP_LAUNCHER_INSTANCE||null},{headers:{"Cache-Control":"no-store"}});
  } catch {
    console.error("Database health check failed");
    return Response.json({status:"unavailable"},{status:503});
  }
}
