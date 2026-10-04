import React, { useEffect, useState } from 'react';
import Button from 'react-bootstrap/Button';
import Alert from 'react-bootstrap/Alert';
import axios from 'axios';
import type { IUser } from 'app/shared/model/user.model';
import Col from 'react-bootstrap/Col';
import FormText from 'react-bootstrap/FormText';
import Row from 'react-bootstrap/Row';
import { Translate, ValidatedField, ValidatedForm, isEmail, translate } from 'react-jhipster';
import { Link, useNavigate, useParams } from 'app/shared/routing/navigation';

import { faArrowLeft, faSave } from '@fortawesome/free-solid-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';

import { useAppDispatch, useAppSelector } from 'app/config/store';
import { languages, locales } from 'app/config/translation';

import { createUser, getRoles, getUser, reset, updateUser } from './user-management.reducer';

export const UserManagementUpdate = () => {
  const dispatch = useAppDispatch();

  const navigate = useNavigate();

  const { login } = useParams<'login'>();
  const isNew = login === undefined;
  const account = useAppSelector(state => state.authentication.account);
  const error = useAppSelector(state => state.userManagement.errorMessage);
  const [emailEnabled, setEmailEnabled] = useState(true);
  const [tenants, setTenants] = useState<{ id: number; tenantName: string }[]>([]);
  useEffect(() => {
    axios.get<{ id: number; tenantName: string }[]>('/api/tenants').then(response => setTenants(response.data));
    axios
      .get<{ features: { outboundEmail: boolean } }>('/management/info')
      .then(response => setEmailEnabled(response.data.features.outboundEmail));
  }, []);

  useEffect(() => {
    if (isNew) {
      dispatch(reset());
    } else {
      dispatch(getUser(login));
    }
    dispatch(getRoles());
    return () => {
      dispatch(reset());
    };
  }, [login]);

  const handleClose = () => {
    navigate('/admin/user-management');
  };

  const saveUser = async (values: IUser) => {
    const input = isNew ? values : { ...values, tenantId: user.tenantId };
    const action = await dispatch(isNew ? createUser(input) : updateUser(input));
    if (createUser.fulfilled.match(action) || updateUser.fulfilled.match(action)) handleClose();
  };

  const user = useAppSelector(state => state.userManagement.user);
  const loading = useAppSelector(state => state.userManagement.loading);
  const updating = useAppSelector(state => state.userManagement.updating);
  const authorities = useAppSelector(state => state.userManagement.authorities);

  return (
    <div>
      <Row className="justify-content-center">
        <Col md="8">
          <h1 data-cy="UserManagementCreateUpdateHeading">
            <Translate contentKey="userManagement.home.createOrEditLabel">Create or edit a User</Translate>
          </h1>
        </Col>
      </Row>
      <Row className="justify-content-center">
        <Col md="8">
          {loading ? (
            <p>{translate('reports.common.loading')}</p>
          ) : (
            <>
              {error && <Alert variant="danger">{error}</Alert>}
              {isNew && !emailEnabled && (
                <Alert variant="info">
                  <Translate contentKey="cloudflare.emailUnavailable" />
                </Alert>
              )}
              <ValidatedForm
                onSubmit={saveUser}
                defaultValues={{
                  ...user,
                  tenantId: user.tenantId ?? account.tenantId,
                  authorities: user.authorities?.length ? user.authorities : ['ROLE_USER'],
                }}
              >
                <ValidatedField
                  type="select"
                  name="tenantId"
                  data-cy="tenantId"
                  label={translate('cloudflare.tenant')}
                  required
                  disabled={!isNew}
                >
                  {tenants.map(tenant => (
                    <option key={tenant.id} value={tenant.id}>
                      {tenant.tenantName}
                    </option>
                  ))}
                </ValidatedField>
                {isNew && (
                  <ValidatedField
                    type="password"
                    name="password"
                    data-cy="initialPassword"
                    label={translate(emailEnabled ? 'cloudflare.initialPassword' : 'cloudflare.initialPasswordRequired')}
                    required={!emailEnabled}
                    validate={{ required: !emailEnabled }}
                    autoComplete="new-password"
                  />
                )}
                {user.id && (
                  <ValidatedField
                    type="text"
                    name="id"
                    data-cy="id"
                    required
                    readOnly
                    label={translate('global.field.id')}
                    validate={{ required: true }}
                  />
                )}
                <ValidatedField
                  type="text"
                  name="login"
                  data-cy="login"
                  label={translate('userManagement.login')}
                  validate={{
                    required: {
                      value: true,
                      message: translate('register.messages.validate.login.required'),
                    },
                    pattern: {
                      value: /^[a-zA-Z0-9!$&*+=?^_`{|}~.-]+@[a-zA-Z0-9-]+(?:\\.[a-zA-Z0-9-]+)*$|^[_.@A-Za-z0-9-]+$/,
                      message: translate('register.messages.validate.login.pattern'),
                    },
                    minLength: {
                      value: 1,
                      message: translate('register.messages.validate.login.minlength'),
                    },
                    maxLength: {
                      value: 50,
                      message: translate('register.messages.validate.login.maxlength'),
                    },
                  }}
                />
                <ValidatedField
                  type="text"
                  name="firstName"
                  data-cy="firstName"
                  label={translate('userManagement.firstName')}
                  validate={{
                    maxLength: {
                      value: 50,
                      message: translate('entity.validation.maxlength', { max: 50 }),
                    },
                  }}
                />
                <ValidatedField
                  type="text"
                  name="lastName"
                  data-cy="lastName"
                  label={translate('userManagement.lastName')}
                  validate={{
                    maxLength: {
                      value: 50,
                      message: translate('entity.validation.maxlength', { max: 50 }),
                    },
                  }}
                />
                <FormText>This field cannot be longer than 50 characters.</FormText>
                <ValidatedField
                  name="email"
                  data-cy="email"
                  label={translate('global.form.email.label')}
                  placeholder={translate('global.form.email.placeholder')}
                  type="email"
                  validate={{
                    required: {
                      value: true,
                      message: translate('global.messages.validate.email.required'),
                    },
                    minLength: {
                      value: 5,
                      message: translate('global.messages.validate.email.minlength'),
                    },
                    maxLength: {
                      value: 254,
                      message: translate('global.messages.validate.email.maxlength'),
                    },
                    validate: v => isEmail(v) || translate('global.messages.validate.email.invalid'),
                  }}
                />
                <ValidatedField
                  type="checkbox"
                  name="activated"
                  data-cy="activated"
                  check
                  value={true}
                  disabled={!user.id}
                  label={translate('userManagement.activated')}
                />
                <ValidatedField type="select" name="langKey" data-cy="langKey" label={translate('userManagement.langKey')}>
                  {locales.map(locale => (
                    <option value={locale} key={locale}>
                      {languages[locale].name}
                    </option>
                  ))}
                </ValidatedField>
                <ValidatedField type="select" name="authorities" data-cy="profiles" multiple label={translate('userManagement.profiles')}>
                  {authorities.map(role => (
                    <option value={role} key={role}>
                      {role}
                    </option>
                  ))}
                </ValidatedField>
                <Button as={Link as any} to="/admin/user-management" replace variant="info" data-cy="entityCreateCancelButton">
                  <FontAwesomeIcon icon={faArrowLeft} />
                  &nbsp;
                  <span className="d-none d-md-inline">
                    <Translate contentKey="entity.action.back">Back</Translate>
                  </span>
                </Button>
                &nbsp;
                <Button variant="primary" type="submit" disabled={updating} data-cy="entityCreateSaveButton">
                  <FontAwesomeIcon icon={faSave} />
                  &nbsp;
                  <Translate contentKey="entity.action.save">Save</Translate>
                </Button>
              </ValidatedForm>
            </>
          )}
        </Col>
      </Row>
    </div>
  );
};

export default UserManagementUpdate;
