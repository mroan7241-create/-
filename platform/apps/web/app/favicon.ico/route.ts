export function GET(request: Request) {
  return Response.redirect(new URL('/brand/zadLogo.png', request.url), 307);
}
