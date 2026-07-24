// Resolver fallback for TypeScript and ESLint. Metro selects alchemy-svg.web.tsx on web and
// alchemy-svg.native.tsx on iOS/Android at runtime.
export { AlchemySvg } from './alchemy-svg.native';
