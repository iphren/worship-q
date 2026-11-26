import { invitationLink, routerServer } from '@worship-q/protocol';

/**
 * QR codes point to the link router only once the phone apps are in the stores, so nobody
 * gets an extra tap before there is an app to open (native apps plan N15, Rollout).
 */
export const ROUTER_LINKS = false;

export interface InviteLinkFields {
  /** The church or public server's address, as the desktop stores it. */
  server: string;
  workspace: string;
  invite: string;
  /** The coordinator on the venue network, when known. */
  lan: { fingerprint: string; addresses: string[]; port: number } | null;
}

/**
 * The link a phone opens to ask for control: through the router when it is switched on and
 * carries this server, otherwise directly to the server's phone page, as before (N31).
 */
export function inviteLink(fields: InviteLinkFields, useRouter = ROUTER_LINKS): string {
  const { server, workspace, invite, lan } = fields;
  const routed = useRouter ? routerServer(server) : null;
  if (routed) {
    return invitationLink({ server: routed, workspace, invite, lan: lan ?? undefined });
  }
  let hints = '';
  if (lan) {
    hints =
      `&f=${encodeURIComponent(lan.fingerprint)}` +
      `&a=${encodeURIComponent(lan.addresses.join(','))}&p=${lan.port}`;
  }
  return `${server}/remote/?w=${encodeURIComponent(workspace)}#i=${invite}${hints}`;
}
