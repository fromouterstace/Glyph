export * from './generated/api';
export * as ApiTypes from './generated/types';
export * from './generated/types';
// Orval gives the path validator and query type the same name for this route.
// Prefer the validator here; the query type remains available via ApiTypes.
export { GetContactDetailParams } from './generated/api';
