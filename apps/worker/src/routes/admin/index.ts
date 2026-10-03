import { Hono } from "hono";
import type { AppEnv } from "../../env";
import { requireAdmin } from "../../middleware/access";
import { catalogRoutes } from "./catalog";
import { insightRoutes } from "./insights";
import { instagramRoutes } from "./instagram";
import { marketingRoutes } from "./marketing";
import { orderRoutes } from "./orders";
import { systemRoutes } from "./system";

export const adminRoutes = new Hono<AppEnv>();

adminRoutes.use("*", requireAdmin);
adminRoutes.route("/", systemRoutes);
adminRoutes.route("/", catalogRoutes);
adminRoutes.route("/", orderRoutes);
adminRoutes.route("/", marketingRoutes);
adminRoutes.route("/", instagramRoutes);
adminRoutes.route("/", insightRoutes);
