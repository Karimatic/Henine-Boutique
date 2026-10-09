/** The settings tabs and every setting in them: used by Paramètres and by the search bar at the top. */
import type { Permission } from "@henine/shared";
import { BellRing, KeyRound, Plug, Phone, ShoppingBag, Store, type LucideIcon } from "lucide-react";
import { tr } from "../i18n";

export type TabKey = "boutique" | "commandes" | "alertes" | "textes" | "contact" | "compte" | "connexions";

export const SETTINGS_TABS: { key: TabKey; label: string; icon: LucideIcon; perm: Permission }[] = [
  { key: "boutique", label: tr("Boutique"), icon: Store, perm: "marketing.edit" },
  { key: "commandes", label: tr("Commandes & livraison"), icon: ShoppingBag, perm: "marketing.edit" },
  { key: "alertes", label: tr("Alertes & délais"), icon: BellRing, perm: "orders.view" },
  { key: "contact", label: tr("Contact & réseaux"), icon: Phone, perm: "marketing.edit" },
  { key: "compte", label: tr("Mon compte"), icon: KeyRound, perm: "dashboard.view" },
  { key: "connexions", label: tr("Connexions"), icon: Plug, perm: "integrations.manage" },
];

/**
 * Every setting, findable by its name or a word about it (French, Arabic, Darija). `find` is
 * the title shown on the page: the search opens its tab and highlights it.
 */
export const SETTINGS_INDEX: { tab: TabKey; find: string; label: string; words: string }[] = [
  { tab: "boutique", find: "Nom de la boutique", label: tr("Nom de la boutique"), words: "nom boutique magasin اسم المتجر المحل" },
  { tab: "boutique", find: "Saison", label: tr("Saison (pyjamas d'été / d'hiver)"), words: "saison été hiver pyjama موسم صيف شتاء بيجامة" },
  { tab: "boutique", find: "Bandeau d'annonces", label: tr("Bandeau d'annonces"), words: "bandeau annonce bannière message haut شريط إعلان" },
  { tab: "boutique", find: "Mettre les commandes en pause", label: tr("Mettre les commandes en pause"), words: "pause vacances fermer maintenance inventaire عطلة إيقاف الطلبات" },
  { tab: "commandes", find: "Livraison au bureau (stop-desk)", label: tr("Livraison au bureau (stop-desk)"), words: "bureau stop desk livraison relais مكتب توصيل" },
  { tab: "commandes", find: "Livraison offerte", label: tr("Livraison offerte"), words: "livraison gratuite offerte franco توصيل مجاني" },
  { tab: "commandes", find: "Protection contre les fausses commandes", label: tr("Protection contre les fausses commandes"), words: "fausses commandes limite spam protection طلبات وهمية حماية" },
  { tab: "alertes", find: "🔔 Nouvelles commandes", label: tr("Son et notifications des nouvelles commandes"), words: "son sonnerie volume notification alerte nouvelle commande fichier mp3 personnalisé صوت تنبيه إشعار رنة ملف" },
  { tab: "alertes", find: "⏰ Délais de traitement (SLA)", label: tr("Délais de traitement (retards)"), words: "délai retard sla temps confirmation préparation expédition آجال تأخير" },
  { tab: "alertes", find: "Coût d'emballage par colis", label: tr("Coût d'emballage (bénéfice)"), words: "emballage coût bénéfice profit تغليف تكلفة ربح" },
  { tab: "textes", find: "", label: tr("Textes de la boutique (accueil, FAQ, annonces)"), words: "texte accueil hero titre faq question message نصوص الأسئلة" },
  { tab: "contact", find: "Coordonnées affichées sur la boutique", label: tr("Téléphone, WhatsApp et réseaux"), words: "téléphone whatsapp instagram tiktok facebook maps abonnés contact هاتف واتساب انستغرام متابعين" },
  { tab: "compte", find: "👤 Mon compte", label: tr("Mon compte et mot de passe"), words: "compte mot de passe password profil حسابي كلمة السر" },
  { tab: "compte", find: "Appareils connectés", label: tr("Appareils connectés"), words: "appareils sessions déconnecter الأجهزة الجلسات" },
  { tab: "compte", find: "🌐 Langue de l'administration", label: tr("Langue de l'administration"), words: "langue arabe français اللغة عربي فرنسي" },
  { tab: "compte", find: "🌗 Apparence", label: tr("Mode sombre / clair"), words: "sombre clair nuit thème apparence dark الوضع الداكن المظهر" },
  { tab: "connexions", find: "📱 Telegram : commandes dans le groupe de l'équipe", label: tr("Telegram"), words: "telegram bot groupe تيليغرام" },
  { tab: "connexions", find: "🚚 ZR Express", label: tr("ZR Express"), words: "zr express transporteur livraison suivi شركة التوصيل" },
  { tab: "connexions", find: "📈 Pixels publicitaires", label: tr("Pixels publicitaires (Meta, TikTok)"), words: "pixel meta facebook tiktok publicité إعلانات" },
];

/** Lower case, no accents, Arabic letter variants folded: "Échange" ~ "echange", "أ" ~ "ا". */
export const fold = (v: string) =>
  v
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[أإآ]/g, "ا")
    .replace(/ة/g, "ه")
    .replace(/ى/g, "ي");
