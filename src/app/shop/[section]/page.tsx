import { notFound } from "next/navigation";
import { CommerceWorkspace } from "../../commerce-workspace";
import { requirePage } from "@/server/auth-http";
export default async function Page({params}:{params:Promise<{section:string}>}){
  const {section}=await params;
  if(!["home","sales","purchases","customers","suppliers","returns","reports","settings"].includes(section))notFound();
  const user=await requirePage(["returns","reports","settings"].includes(section));
  return <CommerceWorkspace key={section} section={section} user={user}/>;
}
