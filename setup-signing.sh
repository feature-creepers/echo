#!/bin/zsh
# Run once. Creates a self-signed code-signing certificate, "JARVIS Local Signing", in your login
# keychain. build-app.sh signs JARVIS.app with it, so the app keeps the same identity from one build
# to the next and macOS stops asking again for the microphone, speech recognition and accessibility.
# The certificate is used for nothing else and never leaves this Mac.
# To undo: delete "JARVIS Local Signing" (certificate and key) in Keychain Access.
set -e
NAME="JARVIS Local Signing"
if security find-identity -p codesigning | grep -q "\"$NAME\""; then
  echo "\"$NAME\" already exists; nothing to do."; exit 0
fi
TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT
cat > "$TMP/cert.cnf" <<CNF
[req]
distinguished_name = dn
x509_extensions = ext
prompt = no
[dn]
CN = $NAME
[ext]
basicConstraints = critical,CA:false
keyUsage = critical,digitalSignature
extendedKeyUsage = critical,codeSigning
CNF
/usr/bin/openssl req -x509 -newkey rsa:2048 -nodes -days 3650 -config "$TMP/cert.cnf" \
  -keyout "$TMP/key.pem" -out "$TMP/cert.pem" 2>/dev/null
# The password only protects the temporary file during the import below.
/usr/bin/openssl pkcs12 -export -inkey "$TMP/key.pem" -in "$TMP/cert.pem" -name "$NAME" \
  -out "$TMP/id.p12" -passout pass:jarvis
security import "$TMP/id.p12" -k "$HOME/Library/Keychains/login.keychain-db" -P jarvis -T /usr/bin/codesign
echo "Created \"$NAME\". Now run ./build-app.sh, then allow the microphone and speech recognition one last time."
