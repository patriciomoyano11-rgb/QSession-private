"""Disabled. This minted a publisher token and sent egress config to the production encoder.

Import does not open a socket. Running it fails before Docker or SSH.
"""


def main():
    raise SystemExit('Refusing to contact production app or encoder')


if __name__ == '__main__':
    main()
