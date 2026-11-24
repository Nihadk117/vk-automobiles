import { getDatabase } from "@/server/database";
import { command,snapshot } from "@/server/commerce";
import { apiError } from "@/server/http";
import { requireUser,authorizedWrite } from "@/server/auth-http";
import { audit,authorizeCommand } from "@/server/auth";
export const runtime="nodejs";
export const dynamic="force-dynamic";
export async function GET(){try{await requireUser();return Response.json(snapshot(getDatabase()),{headers:{"Cache-Control":"no-store"}});}catch(e){return apiError(e);}}
export async function POST(request:Request){try{
  const {user,body}=await authorizedWrite(request),db=getDatabase();
  const result=db.transaction(()=>{authorizeCommand(db,user,body);const result=command(db,body);
    const input=body as {action:string;requestId:string};
    if(!db.prepare("SELECT id FROM auth_audit WHERE action=? AND details=?").get(`shop.${input.action}`,input.requestId))audit(db,user,`shop.${input.action}`,input.requestId);
    return result;
  }).immediate();return Response.json(result);
}catch(e){return apiError(e);}}
