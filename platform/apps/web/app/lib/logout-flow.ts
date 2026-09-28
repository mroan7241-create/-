export async function finishLogout(request: () => Promise<unknown>, navigate: () => void): Promise<string | null> {
  try {
    await request();
    navigate();
    return null;
  } catch {
    return 'تعذّر تسجيل الخروج. تحقق من الاتصال وأعد المحاولة.';
  }
}
