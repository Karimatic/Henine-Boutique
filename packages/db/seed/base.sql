-- Base data: roles, store settings, message templates, default categories.
-- Idempotent. Role permissions must match ROLE_PRESETS in @henine/shared (checked by seed.test.ts).

INSERT INTO roles (key, name, permissions) VALUES
('owner', 'Propriétaire', '["*"]'),
('manager', 'Gérante', '["dashboard.view","orders.view","orders.edit","orders.confirm","orders.ship","orders.export","customers.view","customers.edit","customers.export","carts.view","products.view","products.edit","stock.view","stock.edit","cost.view","sales.view","sales.create","promos.edit","loyalty.edit","marketing.edit","reviews.moderate","contact.view","stats.view","content.edit","delivery.edit","publish","errors.view","audit.view"]'),
('confirmation', 'Confirmatrice', '["dashboard.view","orders.view","orders.edit","orders.confirm","customers.view","carts.view","products.view","stock.view"]'),
('fulfilment', 'Préparation / Stock', '["dashboard.view","orders.view","orders.ship","products.view","stock.view","stock.edit","sales.create"]'),
('marketing', 'Marketing', '["dashboard.view","products.view","products.edit","promos.edit","loyalty.edit","marketing.edit","reviews.moderate","contact.view","stats.view","content.edit","publish"]'),
('readonly', 'Lecture seule', '["dashboard.view","stats.view","orders.view","products.view"]')
ON CONFLICT(key) DO UPDATE SET name = excluded.name, permissions = excluded.permissions;

INSERT OR IGNORE INTO settings (key, value) VALUES
('store', '{"name":"Henine Boutique","tagline_fr":"L''élégance & la qualité au meilleur prix","tagline_ar":"الأناقة والجودة بأفضل سعر","city_fr":"Boumerdès","city_ar":"بومرداس","wilaya":35,"hours_fr":"Ouvert 7j/7","hours_ar":"مفتوح 7/7","currency":"DZD"}'),
('contact', '{"phone":null,"whatsapp":null,"instagram":"https://www.instagram.com/henine.boutique/","tiktok":null,"facebook":null,"maps":null,"address_fr":"Boumerdès","address_ar":"بومرداس"}'),
('hero', '{"eyebrow_fr":"Nouvelle collection","eyebrow_ar":"تشكيلة جديدة","title_fr":"L’élégance & la qualité au meilleur prix","title_ar":"الأناقة والجودة بأفضل سعر","subtitle_fr":"Robes, djebbas et pyjamas choisis avec soin, livrés partout en Algérie.","subtitle_ar":"فساتين، جبات وبيجامات مختارة بعناية، تصلك إلى كل أنحاء الجزائر."}'),
('notifications', '{"telegram_new_order":true,"telegram_status_change":true,"telegram_low_stock":true,"telegram_review":true,"telegram_contact":true,"trust_group_members":true}'),
('announcement', '{"active":true,"messages_fr":["🚚 Livraison dans les 69 wilayas","💵 Paiement à la livraison","🔄 Échange possible","🌸 Boutique à Boumerdès · 7j/7"],"messages_ar":["🚚 التوصيل إلى 69 ولاية","💵 الدفع عند الاستلام","🔄 إمكانية التبديل","🌸 محلنا في بومرداس · 7/7"]}'),
('checkout', '{"cod":true,"express_on_product":true,"require_turnstile":true,"max_orders_per_phone_per_hour":3,"free_shipping_over":null,"desk_enabled":true}'),
('loyalty', '{"enabled":false,"points_per_100da":1,"redeem_value_da":5,"min_redeem":100,"expiry_days":365}'),
('maintenance', '{"active":false,"message_fr":"","message_ar":""}');

INSERT OR IGNORE INTO message_templates (key, channel, body_fr, body_ar) VALUES
('confirm_order', 'whatsapp',
 'Bonjour {name} 🌸 Ici Henine Boutique. Nous confirmons votre commande {code} ({total}). Livraison : {wilaya}. Suivi : {link}',
 'مرحبا {name} 🌸 معك Henine Boutique. نؤكد طلبك {code} ({total}). التوصيل: {wilaya}. تتبع الطلب: {link}'),
('shipped', 'whatsapp',
 'Bonne nouvelle {name} 🚚 Votre commande {code} est expédiée avec ZR Express (n° {tracking}). Suivi : {link}',
 'خبر سار {name} 🚚 تم شحن طلبك {code} مع ZR Express (رقم {tracking}). التتبع: {link}'),
('cart_recovery', 'whatsapp',
 'Bonjour {name} 🌸 Vous avez oublié quelque chose chez Henine ! Votre panier vous attend : {link}',
 'مرحبا {name} 🌸 نسيتِ شيئا في Henine! سلتك في انتظارك: {link}'),
('review_request', 'whatsapp',
 'Merci {name} pour votre confiance 🌸 Votre avis compte beaucoup pour nous : {link}',
 'شكرا {name} على ثقتك 🌸 رأيك يهمنا كثيرا: {link}');

INSERT OR IGNORE INTO categories (slug, name_fr, name_ar, sort) VALUES
('robes', 'Robes', 'فساتين', 1),
('djebba', 'Djebba', 'جبة', 2),
('pyjamas', 'Pyjamas', 'بيجامات', 3);
