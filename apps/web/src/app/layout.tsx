import type { Metadata } from 'next';
import { connection } from 'next/server';
import './globals.css';
export const metadata: Metadata = { title: 'Automation Studio — Scheduled payments', description: 'Schedule MUSD payments with clear spending limits and cash protection.' };
export default async function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) { await connection(); return <html lang="en"><body>{children}</body></html>; }
