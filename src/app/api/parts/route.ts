import { getDatabase } from "@/server/database";
import { addPart,listParts } from "@/server/inventory";
import { requireUser,authorizedWrite } from "@/server/auth-http";
import { audit } from "@/server/auth";
import { apiError } from "@/server/http";
export const runtime="nodejs";
export const dynamic="force-dynamic";
export async function GET(){try{await requireUser();return Response.json({parts:listParts(getDatabase())},{headers:{"Cache-Control":"no-store"}});}catch(e){return apiError(e);}}
export async function POST(request:Request){try{const {user,body}=await authorizedWrite(request,true),db=getDatabase();const part=db.transaction(()=>{const part=addPart(db,body);audit(db,user,"part.created",String(part.id));return part;}).immediate();return Response.json({part},{status:201});}catch(e){return apiError(e);}}
