/**
 * Surfaces publiques — point d'entrée SÉPARÉ du cœur.
 *
 * Ces exports tirent React. Les garder hors de `src/lib/scheduling/index.ts`
 * évite qu'une route serveur, qui n'a besoin que de la logique, n'embarque des
 * composants d'interface dans son bundle.
 */
export { SCHEDULING_CSS, brandRootStyle } from './styles';
export { BrandMark } from './Brand';
export { BookingPage, type BookingConfirmation, type BookingPageProps } from './BookingPage';
export { ManagePage, type ManageBooking, type ManagePageProps } from './ManagePage';
export { SlotPicker } from './SlotPicker';
export { TimezoneBar } from './TimezoneBar';
