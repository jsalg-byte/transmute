import { Asset } from 'expo-asset';
import { useEffect, useState } from 'react';
import type { CSSProperties } from 'react';
import { StyleSheet } from 'react-native';
import type { StyleProp, ViewStyle } from 'react-native';

type AlchemySvgProps = {
  source: number;
  width: number;
  height: number;
  style?: StyleProp<ViewStyle>;
};

type TransformPart = Record<string, string | number>;

function toCssTransform(transform: unknown) {
  if (!Array.isArray(transform)) return undefined;

  return transform
    .map((part: TransformPart) => {
      const [operation, value] = Object.entries(part)[0] ?? [];
      if (!operation) return '';
      if (operation === 'translateX' || operation === 'translateY') return `${operation}(${value}px)`;
      return `${operation}(${value})`;
    })
    .filter(Boolean)
    .join(' ');
}

/** Browser-only renderer: preserves Wikimedia SVGs as files instead of expanding their XML into React props. */
export function AlchemySvg({ source, width, height, style }: AlchemySvgProps) {
  const [uri, setUri] = useState<string | null>(null);

  useEffect(() => {
    let active = true;

    Asset.loadAsync(source).then(([asset]) => {
      if (active) setUri(asset.localUri ?? asset.uri);
    });

    return () => {
      active = false;
    };
  }, [source]);

  const flattened = StyleSheet.flatten(style) ?? {};
  const { transform, ...rest } = flattened;
  const cssStyle = {
    ...rest,
    width,
    height,
    display: 'block',
    objectFit: 'contain',
    transform: toCssTransform(transform),
  };

  return uri ? <img alt="" src={uri} style={cssStyle as unknown as CSSProperties} /> : <div style={{ width, height }} />;
}
