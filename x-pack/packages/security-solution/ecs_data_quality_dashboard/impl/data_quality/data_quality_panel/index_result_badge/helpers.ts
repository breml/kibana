/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { FAILED, PASSED, THIS_INDEX_HAS_NOT_BEEN_CHECKED } from '../summary_table/translations';

export const getIndexResultBadgeColor = (incompatible: number | undefined): string => {
  if (incompatible == null) {
    return 'ghost';
  } else if (incompatible === 0) {
    return '#6dcbb1';
  } else {
    return 'danger';
  }
};

export const getIndexResultToolTip = (incompatible: number | undefined): string => {
  if (incompatible == null) {
    return THIS_INDEX_HAS_NOT_BEEN_CHECKED;
  } else if (incompatible === 0) {
    return PASSED;
  } else {
    return FAILED;
  }
};
