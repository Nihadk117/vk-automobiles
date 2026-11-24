import { getDatabase } from "@/server/database";
import { editPart,partHistory } from "@/server/inventory";
import { apiError,partId } from "@/server/http";
import { requireUser,authorizedWrite } from "@/server/auth-http";
import { audit } from "@/server/auth";
export const runtime="nodejs";
export const dynamic="force-dynamic";
export async function PATCH(request:Request,context:{params:Promise<{id:string}>}){
  try {
    const {user,body}=await authorizedWrite(request,true),id=partId((await context.params).id),db=getDatabase();
    const part=db.transaction(()=>{const part=editPart(db,id,body);audit(db,user,"part.edited",String(id));return part;}).immediate();
    return Response.json({part});
  }catch(error){return apiError(error);}
}
export async function GET(_request:Request,context:{params:Promise<{id:string}>}){
  try {
    await requireUser();
    return Response.json(partHistory(getDatabase(),partId((await context.params).id)),{headers:{"Cache-Control":"no-store"}});
  }catch(error){return apiError(error);}
}
