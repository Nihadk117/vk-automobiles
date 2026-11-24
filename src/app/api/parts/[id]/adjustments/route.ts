import { getDatabase } from "@/server/database";
import { adjustStock } from "@/server/inventory";
import { apiError,partId } from "@/server/http";
import { authorizedWrite } from "@/server/auth-http";
import { audit } from "@/server/auth";
export const runtime="nodejs";
export async function POST(request:Request,context:{params:Promise<{id:string}>}){
  try {
    const {user,body}=await authorizedWrite(request,true),id=partId((await context.params).id),db=getDatabase();
    const part=db.transaction(()=>{const part=adjustStock(db,id,body);audit(db,user,"stock.corrected",String(id));return part;}).immediate();
    return Response.json({part});
  }catch(error){return apiError(error);}
}
