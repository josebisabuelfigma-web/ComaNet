export type UserRole = "super_admin" | "owner" | "cajero" | "mesero" | "cocina";
export type Fulfillment = "domicilio" | "recoger";
export type PaymentMethod = "efectivo" | "transferencia";
export type OrderChannel = "domicilio" | "mesa";
export type OrderStatus = "pendiente" | "despachado" | "abierta" | "pagada" | "cancelado";

// NOTA: estos modelos usan `type X = {...}` y no `interface X {...}` a
// propósito. El cliente de Supabase exige que cada Row/Insert/Update sea
// estructuralmente compatible con `Record<string, unknown>`, y TypeScript
// solo reconoce esa compatibilidad para alias de tipo, no para interfaces.

export type Organization = {
  id: string;
  name: string;
  slug: string;
  max_usuarios: number;
  is_active: boolean;
  legal_name: string | null;
  tax_id: string | null;
  billing_address: string | null;
  billing_phone: string | null;
  billing_email: string | null;
  ticket_footer: string | null;
  currency: string;
  logo_url: string | null;
  next_order_number: number;
  created_at: string;
};

export type Profile = {
  id: string;
  organization_id: string | null;
  username: string;
  full_name: string;
  role: UserRole;
  auth_email: string;
  created_at: string;
};

export type ModuleDef = {
  id: string;
  key: string;
  name: string;
  description: string | null;
  price: number;
  created_at: string;
};

export type OrganizationModule = {
  organization_id: string;
  module_id: string;
  enabled: boolean;
  enabled_at: string | null;
};

export type RestaurantSettings = {
  organization_id: string;
  whatsapp_number: string | null;
  delivery_fee: number;
  delivery_message: string | null;
  disposables_fee: number;
  disposables_label: string;
  accepts_cash: boolean;
  accepts_transfer: boolean;
  transfer_instructions: string | null;
  orders_open: boolean;
  pickup_enabled: boolean;
  opens_at: string | null;
  closes_at: string | null;
  open_days: number[];
  welcome_message: string | null;
  updated_at: string;
};

export type MenuCategory = {
  id: string;
  organization_id: string;
  name: string;
  sort_order: number;
  is_combo_category: boolean;
  created_at: string;
};

export type MenuProduct = {
  id: string;
  organization_id: string;
  category_id: string;
  name: string;
  description: string | null;
  price: number;
  image_url: string | null;
  is_available: boolean;
  is_active: boolean;
  is_combo: boolean;
  combo_auto_off: boolean;
  sort_order: number;
  created_at: string;
  updated_at: string;
};

export type MenuComboItem = {
  id: string;
  organization_id: string;
  combo_id: string;
  product_id: string;
  quantity: number;
};

export type ComboSnapshotLine = {
  product_id: string;
  name: string;
  quantity: number;
  unit_price: number;
};

export type RestaurantTable = {
  id: string;
  organization_id: string;
  name: string;
  sort_order: number;
  created_at: string;
};

export type Order = {
  id: string;
  organization_id: string;
  order_number: number;
  channel: OrderChannel;
  status: OrderStatus;
  fulfillment: Fulfillment | null;
  table_id: string | null;
  customer_name: string | null;
  customer_phone: string | null;
  address: string | null;
  notes: string | null;
  payment_method: PaymentMethod | null;
  subtotal: number;
  delivery_fee: number;
  disposables_fee: number;
  total: number;
  created_by: string | null;
  created_at: string;
  completed_at: string | null;
  completed_by: string | null;
  kitchen_sent_at: string | null;
  kitchen_done_at: string | null;
  payment_requested_at: string | null;
  payment_requested_method: PaymentMethod | null;
};

export type OrderItem = {
  id: string;
  organization_id: string;
  order_id: string;
  product_id: string | null;
  product_name: string;
  unit_price: number;
  quantity: number;
  notes: string | null;
  combo_snapshot: ComboSnapshotLine[] | null;
  kitchen_status: "pendiente" | "listo";
  kitchen_done_at: string | null;
  sent_to_kitchen_at: string | null;
  created_at: string;
};

export type KitchenChange = {
  id: string;
  organization_id: string;
  order_id: string;
  kind: "envio" | "agregado" | "modificado";
  description: string;
  created_by: string | null;
  created_at: string;
  acked_at: string | null;
};

export type CashSession = {
  id: string;
  organization_id: string;
  opening_amount: number;
  opened_by: string | null;
  opened_at: string;
  closed_at: string | null;
  closed_by: string | null;
  counted_cash: number | null;
  expected_cash: number | null;
  difference: number | null;
  summary: {
    orders: number;
    cash_sales: number;
    transfer_sales: number;
    ingresos: number;
    egresos: number;
  } | null;
  notes: string | null;
};

export type CashMovement = {
  id: string;
  organization_id: string;
  session_id: string | null;
  type: "ingreso" | "egreso";
  amount: number;
  description: string;
  payment_method: PaymentMethod;
  invoice_path: string | null;
  invoice_name: string | null;
  counterparty: string | null;
  created_by: string | null;
  created_at: string;
};

export type ActivityLogEntry = {
  id: string;
  organization_id: string | null;
  user_id: string | null;
  username: string;
  role: UserRole;
  action: string;
  details: string | null;
  created_at: string;
};

export type SalesSummaryRow = {
  channel: OrderChannel;
  fulfillment: Fulfillment | "mesa";
  payment_method: string;
  orders_count: number;
  subtotal: number;
  delivery_fees: number;
  disposables: number;
  total: number;
};

export type SalesByProductRow = {
  product_name: string;
  channel: OrderChannel;
  quantity: number;
  revenue: number;
};

// Tipado escrito a mano que refleja sql/001..005. Si más adelante conectan el
// CLI de Supabase, `supabase gen types typescript` puede reemplazar este
// archivo sin que el resto del código cambie.
export type Database = {
  public: {
    Tables: {
      organizations: {
        Row: Organization;
        Insert: Partial<Organization> & Pick<Organization, "name" | "slug">;
        Update: Partial<Organization>;
        Relationships: [];
      };
      profiles: {
        Row: Profile;
        Insert: Partial<Profile> &
          Pick<Profile, "id" | "username" | "full_name" | "auth_email" | "role">;
        Update: Partial<Profile>;
        Relationships: [];
      };
      modules: {
        Row: ModuleDef;
        Insert: Partial<ModuleDef> & Pick<ModuleDef, "key" | "name">;
        Update: Partial<ModuleDef>;
        Relationships: [];
      };
      organization_modules: {
        Row: OrganizationModule;
        Insert: Partial<OrganizationModule> &
          Pick<OrganizationModule, "organization_id" | "module_id">;
        Update: Partial<OrganizationModule>;
        Relationships: [];
      };
      restaurant_settings: {
        Row: RestaurantSettings;
        Insert: Partial<RestaurantSettings> & Pick<RestaurantSettings, "organization_id">;
        Update: Partial<RestaurantSettings>;
        Relationships: [];
      };
      menu_categories: {
        Row: MenuCategory;
        Insert: Partial<MenuCategory> & Pick<MenuCategory, "organization_id" | "name">;
        Update: Partial<MenuCategory>;
        Relationships: [];
      };
      menu_combo_items: {
        Row: MenuComboItem;
        Insert: Partial<MenuComboItem> &
          Pick<MenuComboItem, "organization_id" | "combo_id" | "product_id">;
        Update: Partial<MenuComboItem>;
        Relationships: [];
      };
      menu_products: {
        Row: MenuProduct;
        Insert: Partial<MenuProduct> &
          Pick<MenuProduct, "organization_id" | "category_id" | "name">;
        Update: Partial<MenuProduct>;
        Relationships: [];
      };
      restaurant_tables: {
        Row: RestaurantTable;
        Insert: Partial<RestaurantTable> & Pick<RestaurantTable, "organization_id" | "name">;
        Update: Partial<RestaurantTable>;
        Relationships: [];
      };
      orders: {
        Row: Order;
        Insert: Partial<Order> &
          Pick<Order, "organization_id" | "channel" | "status">;
        Update: Partial<Order>;
        Relationships: [];
      };
      order_items: {
        Row: OrderItem;
        Insert: Partial<OrderItem> &
          Pick<OrderItem, "organization_id" | "order_id" | "product_id" | "quantity">;
        Update: Partial<OrderItem>;
        Relationships: [];
      };
      cash_sessions: {
        Row: CashSession;
        Insert: Partial<CashSession> & Pick<CashSession, "organization_id">;
        Update: Partial<CashSession>;
        Relationships: [];
      };
      cash_movements: {
        Row: CashMovement;
        Insert: Partial<CashMovement> &
          Pick<CashMovement, "organization_id" | "type" | "amount" | "description">;
        Update: Partial<CashMovement>;
        Relationships: [];
      };
      kitchen_changes: {
        Row: KitchenChange;
        Insert: Partial<KitchenChange> &
          Pick<KitchenChange, "organization_id" | "order_id" | "kind" | "description">;
        Update: Partial<KitchenChange>;
        Relationships: [];
      };
      activity_log: {
        Row: ActivityLogEntry;
        Insert: Partial<ActivityLogEntry> & Pick<ActivityLogEntry, "username" | "role" | "action">;
        Update: Partial<ActivityLogEntry>;
        Relationships: [];
      };
    };
    Views: Record<string, never>;
    Functions: {
      create_delivery_order: {
        Args: {
          p_org: string;
          p_items: { productId: string; quantity: number; notes?: string }[];
          p_customer_name: string;
          p_customer_phone: string;
          p_address: string;
          p_notes: string;
          p_payment: PaymentMethod;
          p_fulfillment: Fulfillment;
        };
        Returns: {
          order_id: string;
          order_number: number;
          subtotal: number;
          delivery_fee: number;
          disposables_fee: number;
          total: number;
        }[];
      };
      dispatch_order: { Args: { p_order_id: string }; Returns: undefined };
      cancel_order: { Args: { p_order_id: string }; Returns: undefined };
      close_table_order: {
        Args: { p_order_id: string; p_payment: PaymentMethod };
        Returns: number;
      };
      set_product_availability: {
        Args: { p_product_id: string; p_available: boolean };
        Returns: undefined;
      };
      set_item_kitchen_status: {
        Args: { p_item_id: string; p_ready: boolean };
        Returns: undefined;
      };
      set_order_kitchen_status: {
        Args: { p_order_id: string; p_ready: boolean };
        Returns: undefined;
      };
      send_order_to_kitchen: { Args: { p_order_id: string }; Returns: undefined };
      ack_kitchen_changes: { Args: { p_order_id: string }; Returns: undefined };
      request_table_payment: {
        Args: { p_order_id: string; p_payment: PaymentMethod };
        Returns: undefined;
      };
      cancel_table_payment_request: { Args: { p_order_id: string }; Returns: undefined };
      update_delivery_order_info: {
        Args: {
          p_order_id: string;
          p_customer_name: string;
          p_customer_phone: string;
          p_address: string;
          p_notes: string;
          p_payment: PaymentMethod;
          p_fulfillment?: Fulfillment | null;
          p_delivery_fee?: number | null;
          p_disposables_fee?: number | null;
        };
        Returns: undefined;
      };
      register_cash_movement: {
        Args: {
          p_type: "ingreso" | "egreso";
          p_amount: number;
          p_description: string;
          p_payment: PaymentMethod;
          p_invoice_path: string | null;
          p_invoice_name: string | null;
          p_counterparty?: string | null;
        };
        Returns: string;
      };
      open_cash_session: { Args: { p_opening: number }; Returns: string };
      close_cash_session: {
        Args: { p_session_id: string; p_counted: number; p_notes: string };
        Returns: {
          orders: number;
          cash_sales: number;
          transfer_sales: number;
          ingresos: number;
          egresos: number;
          expected_cash: number;
          counted_cash: number;
          difference: number;
        };
      };
      report_sales_summary: {
        Args: { p_from: string; p_to: string };
        Returns: SalesSummaryRow[];
      };
      report_sales_by_product: {
        Args: { p_from: string; p_to: string };
        Returns: SalesByProductRow[];
      };
    };
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
};
