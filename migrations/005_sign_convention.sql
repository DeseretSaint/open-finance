-- 005: flip transaction sign convention to match bank apps — income POSITIVE,
-- expenses NEGATIVE. Old data stored positive=expense and negative=income.
-- Flip every row so existing installs read naturally (expenses red, income green).
UPDATE transactions SET amount_cents = -amount_cents;
