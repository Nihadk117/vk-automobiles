import { InventoryWorkspace } from "./workspace";
import { requirePage } from "@/server/auth-http";
export default async function Home() { const user=await requirePage();return <InventoryWorkspace user={user}/>; }
