#!/usr/bin/env bash

set -euo pipefail

RELEASE_BUILD="${RELEASE_BUILD:="false"}"
VERSION_QUALIFIER="${VERSION_QUALIFIER:=""}"

BASE_VERSION="$(jq -r '.version' package.json)"

if [[ "$VERSION_QUALIFIER" == "" ]]; then
  QUALIFIER_VERSION="$BASE_VERSION"
else
  QUALIFIER_VERSION="$BASE_VERSION-$VERSION_QUALIFIER"
fi

if [[ "$RELEASE_BUILD" == "true" ]]; then
  FULL_VERSION="$QUALIFIER_VERSION"
  BUILD_ARGS=("--release" "--version-qualifier=$VERSION_QUALIFIER")
  WORKFLOW="staging"
else
  FULL_VERSION="$QUALIFIER_VERSION-SNAPSHOT"
  BUILD_ARGS=("--version-qualifier=$VERSION_QUALIFIER")
  WORKFLOW="snapshot"
fi

ARTIFACTS_SUBDOMAIN="artifacts-$WORKFLOW"
ARTIFACTS_MANIFEST_FQDN="https://$ARTIFACTS_SUBDOMAIN.elastic.co"
KIBANA_MANIFEST_LATEST="$ARTIFACTS_MANIFEST_FQDN/kibana/latest/$FULL_VERSION.json"
BEATS_MANIFEST_LATEST="$ARTIFACTS_MANIFEST_FQDN/beats/latest/$FULL_VERSION.json"

export VERSION_QUALIFIER
export BASE_VERSION
export QUALIFIER_VERSION
export FULL_VERSION
export BUILD_ARGS
export WORKFLOW
export KIBANA_MANIFEST_LATEST
export BEATS_MANIFEST_LATEST

echo VERSION_QUALIFIER = $VERSION_QUALIFIER
echo BASE_VERSION = $BASE_VERSION
echo QUALIFIER_VERSION = $QUALIFIER_VERSION
echo FULL_VERSION = $FULL_VERSION
echo BUILD_ARGS = $BUILD_ARGS
echo WORKFLOW = $WORKFLOW
echo KIBANA_MANIFEST_LATEST = $KIBANA_MANIFEST_LATEST
echo BEATS_MANIFEST_LATEST = $BEATS_MANIFEST_LATEST
