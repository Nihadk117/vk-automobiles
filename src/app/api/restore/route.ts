import { restoreDatabase,getDatabase } from "@/server/database";
import { requireUser,clearSessionCookie } from "@/server/auth-http";
import { audit } from "@/server/auth";
import { apiError,verifyWrite } from "@/server/http";
import { InventoryError } from "@/server/inventory";
export const runtime="nodejs";
export async function POST(request:Request){
  try{
    const user=await requireUser(true);
    verifyWrite(request);
    if(Number(request.headers.get("content-length")||0)>51*1024*1024)throw new InventoryError("Backup is too large.",413);
    const form=await request.formData(),file=form.get("file");
    if(form.get("confirmation")!=="RESTORE VK AUTOMOBILES"||!(file instanceof File)||file.size>50*1024*1024)throw new InventoryError("Choose a backup and type RESTORE VK AUTOMOBILES to confirm.",400);
    const bytes=Buffer.from(await file.arrayBuffer());await requireUser(true);
    const recovery=await restoreDatabase(bytes);
    const db=getDatabase();db.prepare("DELETE FROM auth_sessions").run();audit(db,user,"backup.restored",recovery);await clearSessionCookie();return Response.json({restored:true,recovery});
  }catch(e){return apiError(e);}
}
