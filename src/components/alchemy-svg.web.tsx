import { Asset } from 'expo-asset';
import type { CSSProperties } from 'react';
import { StyleSheet } from 'react-native';
import type { StyleProp, ViewStyle } from 'react-native';

type AlchemySvgProps = {
  source: number;
  width: number;
  height: number;
  monochrome?: "light";
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

/** Browser-only renderer for bundled SVGs. Asset resolution is synchronous, avoiding a post-render artwork swap. */
export function AlchemySvg({ source, width, height, monochrome, style }: AlchemySvgProps) {
  const asset = Asset.fromModule(source);
  const uri = asset.localUri ?? asset.uri;

  const flattened = StyleSheet.flatten(style) ?? {};
  const { transform, ...rest } = flattened;
  const cssStyle = {
    ...rest,
    width,
    height,
    display: 'block',
    filter: monochrome === 'light' ? 'brightness(0) invert(1)' : undefined,
    objectFit: 'contain',
    transform: toCssTransform(transform),
  };

  return <img alt="" src={uri} style={cssStyle as unknown as CSSProperties} />;
}
