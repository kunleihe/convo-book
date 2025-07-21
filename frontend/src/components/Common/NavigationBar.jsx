import React from 'react';
import { Navbar, Nav, Container, Button } from 'react-bootstrap';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../hooks/useAuth.jsx';

const NavigationBar = () => {
    const navigate = useNavigate();
    const { logout, user } = useAuth();

    const handleLibraryClick = () => {
        navigate('/');
    };

    const handleLogout = () => {
        logout();
        // Navigation will be handled automatically by the auth system
    };

    return (
        <Navbar expand="lg" className="bg-body-tertiary shadow-sm">
            <Container>
                <Navbar.Brand href="/" className="fw-bold">
                    Convo Book
                </Navbar.Brand>
                <Navbar.Toggle aria-controls="basic-navbar-nav" />
                <Navbar.Collapse id="basic-navbar-nav">
                    <Nav className="ms-auto">
                        <Nav.Link onClick={handleLibraryClick} style={{ cursor: 'pointer' }}>
                            Library
                        </Nav.Link>
                        <Button
                            variant="outline-secondary"
                            size="sm"
                            onClick={handleLogout}
                            className="ms-2"
                        >
                            Logout
                        </Button>
                    </Nav>
                </Navbar.Collapse>
            </Container>
        </Navbar>
    );
};

export default NavigationBar; 