import {
  appleAppAssociation,
  mobileAssociationResponse,
} from "@/server/mobile-app-association";

export function GET() {
  return mobileAssociationResponse(
    appleAppAssociation(process.env.ORBIT_IOS_APP_LINK_IDENTIFIER),
  );
}
