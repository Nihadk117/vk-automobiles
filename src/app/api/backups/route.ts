import { getDatabase } from "@/server/database";
import { backupBytes,createBackup,lastBackupError,listBackups } from "@/server/backups";
import { apiError,verifyWrite } from "@/server/http";
import { requireUser } from "@/server/auth-http";
import { audit } from "@/server/auth";
export const runtime="nodejs";
export const dynamic="force-dynamic";
export async function GET(request:Request){
  try{
    const user=await requireUser(true);
    const db=getDatabase(),name=new URL(request.url).searchParams.get("download");
    if(name){const bytes=backupBytes(db,name);audit(db,user,"backup.downloaded",name);return new Response(new Uint8Array(bytes),{headers:{"Content-Type":"application/vnd.sqlite3","Content-Disposition":`attachment; filename="${name}"`,"Cache-Control":"no-store"}});}
    try{return Response.json({backups:listBackups(db),error:lastBackupError},{headers:{"Cache-Control":"no-store"}});}
    catch{return Response.json({backups:[],error:"Backup storage is unavailable. Check the backup folder and disk permissions, then create a manual backup."},{headers:{"Cache-Control":"no-store"}});}
  }catch(e){return apiError(e);}
}
export async function POST(request:Request){try{const user=await requireUser(true);verifyWrite(request);const db=getDatabase(),name=await createBackup(db);audit(db,user,"backup.created",name);return Response.json({name});}catch(e){return apiError(e);}}
