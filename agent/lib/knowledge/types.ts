export type ProductCategory =
  | "tshirt"
  | "oversized-tshirt"
  | "polo"
  | "shirt"
  | "hoodie"
  | "sweatshirt"
  | "joggers"
  | "shorts"
  | "dress"
  | "top"
  | "accessory";

export type Fit = "oversized" | "relaxed" | "regular" | "slim" | "unknown";

export interface Product {
  id: string;
  name: string;
  category: ProductCategory;
  fit: Fit;
  sizes: string[];
  /** Units in stock per offered size (all colors pooled). */
  stock: Record<string, number>;
  colors: string[];
  /** Fabric / composition as the brand lists it. */
  material: string;
  /** Fabric weight in GSM where the brand lists one (tops, hoodies). */
  gsm?: number;
  priceInr: number;
  theme: string;
  returnable: boolean;
  /** Search/similarity hooks the engine can reason over. */
  tags: string[];
  inventorySource?: "synthetic_demo";
  catalogSource?: { url: string; observedAt: string; unknownFields: string[]; attributeOrigin: "public_snapshot" };
  garmentMeasurements?: Record<string, { chestIn?: number; lengthIn?: number; shoulderIn?: number }>;

}

export interface OrderItem {
  itemId: string;
  productId: string;
  size: string;
  color: string;
  qty: number;
  priceInr: number;
}

export type OrderStatus = "placed" | "shipped" | "delivered" | "returned";

export interface Order {
  orderId: string;
  placedDaysAgo: number;
  /** null while the order is still in transit. */
  deliveredDaysAgo: number | null;
  status: OrderStatus;
  items: OrderItem[];
}

export type PastOutcome = "refund" | "exchange" | "replacement";

export interface ReturnRecord {
  returnId: string;
  orderId: string;
  productId: string;
  returnedDaysAgo: number;
  reasonLabel: string;
  outcome: PastOutcome;
}

export interface Customer {
  customerId: string;
  name: string;
  phone: string;
  city: string;
  orders: Order[];
  returns: ReturnRecord[];
}
