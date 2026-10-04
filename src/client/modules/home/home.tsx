import './home.scss';

import React, { useEffect } from 'react';
import Alert from 'react-bootstrap/Alert';
import Col from 'react-bootstrap/Col';
import Row from 'react-bootstrap/Row';
import { Translate, translate } from 'app/shared/jhipster/language';
import { Link } from 'app/shared/routing/navigation';

import { useAppDispatch, useAppSelector } from 'app/config/store';
import { getDashboardReports } from 'app/shared/reducers/dashboard-reports.reducer';

export const Home = () => {
  const dispatch = useAppDispatch();
  const account = useAppSelector(state => state.authentication.account);
  const isAuthenticated = useAppSelector(state => state.authentication.isAuthenticated);
  const dashboardReports = useAppSelector(state => state.dashboardReportsState.entity);

  useEffect(() => {
    if (isAuthenticated) {
      dispatch(getDashboardReports());
    }
  }, [account?.login, dispatch, isAuthenticated]);

  const renderDashboardCard = (title: string, value?: number | null) => (
    <div className="dashboard-card">
      <span className="dashboard-card-label">{title}</span>
      <span className="dashboard-card-value">{value ? value : 0} TL</span>
    </div>
  );

  return (
    <Row>
      <Col md="9">
        <h1 className="display-4">
          <Translate contentKey="home.title" />
        </h1>
        <p className="lead">
          <Translate contentKey="home.subtitle">This is your homepage</Translate>
        </p>
        {account?.login ? (
          <div>
            <Alert variant="success">
              <Translate contentKey="home.logged.message" interpolate={{ username: account.login }}>
                You are logged in as user {account.login}.
              </Translate>
            </Alert>
            <div className="dashboard-cards">
              {renderDashboardCard(translate('home.cardCash'), dashboardReports.kasadaNeVar)}
              {renderDashboardCard(translate('home.cardDailyRevenue'), dashboardReports.gunlukCiro)}
              {renderDashboardCard(translate('home.cardCardSales'), dashboardReports.kartliSatis)}
              {renderDashboardCard(translate('home.cardCashSales'), dashboardReports.nakitSatis)}
            </div>
          </div>
        ) : (
          <div>
            <Alert variant="warning">
              <Translate contentKey="global.messages.info.authenticated.prefix">If you want to </Translate>

              <Link to="/login" className="alert-link">
                <Translate contentKey="global.messages.info.authenticated.link"> sign in</Translate>
              </Link>
              <Translate contentKey="cloudflare.signInSuffix" />
            </Alert>
          </div>
        )}
      </Col>
    </Row>
  );
};

export default Home;
