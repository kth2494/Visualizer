import type { Settings } from "../types";
import { publicUrl } from "../utils/publicUrl";
import { FIELD_SCHEME_IMAGES, type ColorScheme } from "../config/defaults";

const FALLBACK_FIELD_MAP = "/fields/decode.webp";

/** Structures drawn over a custom field image, or null for the built-in fields. */
export function fieldOverlaySource(
  settings: Settings,
  scheme: ColorScheme,
): string | null {
  // ponytail: custom backgrounds get this season's structures; pick per season if another field needs it.
  return settings.fieldMap === "custom"
    ? `./fields/biobuzz-structures-${scheme}.webp`
    : null;
}

/** The field image to draw, using the variant for `scheme` when the field has one. */
export function fieldMapSource(
  settings: Settings,
  scheme: ColorScheme,
): string {
  if (settings.fieldMap === "custom") {
    return publicUrl(settings.customFieldImage || FALLBACK_FIELD_MAP);
  }
  if (!settings.fieldMap) return publicUrl(FALLBACK_FIELD_MAP);
  const file =
    FIELD_SCHEME_IMAGES[settings.fieldMap]?.[scheme] ?? settings.fieldMap;
  return publicUrl(`/fields/${file}`);
}
