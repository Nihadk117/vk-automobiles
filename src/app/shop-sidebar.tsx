import Link from "next/link";
import { ShopNavigation } from "./navigation";
import { SHOP_CATEGORY } from "@/shared/shop-profile";
import type { ShopUser } from "@/shared/auth";
import { SessionControls } from "./session-controls";
export function ShopSidebar({active,shopName,user}:{active:string;shopName:string;user:ShopUser}){
  return <aside className="sidebar">
    <Link className="brand" href="/shop/home"><span className="brand-mark" aria-hidden="true">VK</span><span className="brand-type"><strong>{shopName}</strong><small>{SHOP_CATEGORY}</small></span></Link>
    <p className="nav-label">SHOP MANAGEMENT</p><ShopNavigation active={active} owner={user.role==="owner"}/>
    <SessionControls user={user}/>
    <div className="sidebar-note"><strong>Your daily shop workspace</strong><p>Stock, billing and accounts.</p><small>Works offline · INR</small></div>
  </aside>;
}
