import { AbanmiPortal } from './portal-context';
import './portal.css';
export default function AbanmiLayout({ children }: { children: React.ReactNode }) { return <AbanmiPortal>{children}</AbanmiPortal>; }
