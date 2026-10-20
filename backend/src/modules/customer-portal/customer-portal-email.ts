export class CustomerPortalEmail {
  static normalize(value: string): string {
    return value.normalize('NFKC').trim().toLocaleLowerCase('en-US');
  }
}
