import { useEffect, useState } from "react";
import { StyleSheet, View } from "react-native";
import { SvgXml } from "react-native-svg";

type FastingHourglassProps = {
  progress: number | null;
  size?: number;
};

// Heraldic hourglass by Eugenio Hansen, OFS, CC BY-SA 3.0:
// https://commons.wikimedia.org/wiki/File:Heraldic_hourglass.svg
const HERALDIC_HOURGLASS_URI =
  "https://upload.wikimedia.org/wikipedia/commons/3/3d/Heraldic_hourglass.svg";

/**
 * The supplied heraldic artwork is intentionally kept intact. Its white sand
 * is part of the original illustration, so progress is communicated by the
 * adjacent timer and progress track rather than redrawing over the art.
 */
export function FastingHourglass({ size = 156 }: FastingHourglassProps) {
  const [svgXml, setSvgXml] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    void fetch(HERALDIC_HOURGLASS_URI)
      .then((response) => {
        if (!response.ok) {
          throw new Error(`Could not load heraldic hourglass: ${response.status}`);
        }
        return response.text();
      })
      .then((source) => {
        if (!cancelled) {
          // The original root has fixed dimensions but no viewBox. Those fixed values
          // override the component viewport and crop the artwork, so replace the root
          // tag with a scalable one while leaving every illustrated path intact.
          setSvgXml(
            source.replace(
              /<svg\b[^>]*>/,
              '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 883.9 1122.628">',
            ),
          );
        }
      })
      .catch(() => {
        if (!cancelled) {
          setSvgXml(null);
        }
      });

    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <View accessible={false} style={[styles.wrap, { height: size * 1.28, width: size }]}>
      {svgXml ? <SvgXml height={size * 1.28} xml={svgXml} width={size} /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { alignItems: "center", justifyContent: "center" },
});
