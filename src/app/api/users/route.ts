import { requireUser,authorizedWrite } from "@/server/auth-http";
import { getDatabase } from "@/server/database";
import { manageUser } from "@/server/auth";
import { apiError } from "@/server/http";
export const runtime="nodejs";
export const dynamic="force-dynamic";
export async function GET(){try{await requireUser(true);return Response.json({users:getDatabase().prepare("SELECT id,username,role,enabled FROM auth_users ORDER BY id").all(),audit:getDatabase().prepare("SELECT id,actor_name AS actor,action,details,created_at AS createdAt FROM auth_audit ORDER BY id DESC LIMIT 200").all()},{headers:{"Cache-Control":"no-store"}});}catch(e){return apiError(e);}}
export async function POST(request:Request){try{const {user:actor,body}=await authorizedWrite(request,true);manageUser(getDatabase(),actor,body);return Response.json({saved:true});}catch(e){return apiError(e);}}
