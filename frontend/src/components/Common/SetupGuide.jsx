import React, { useState } from 'react';
import { Container, Card, Form, Button } from 'react-bootstrap';
import { useNavigate } from 'react-router-dom';
import zoomShare from '../../assets/zoom-share.png';
import zoomAudioVideo from '../../assets/zoom-audio-video.png';

const STEPS = [
  {
    id: 'share-screen',
    image: zoomShare,
    alt: 'Zoom toolbar with Share button highlighted',
    label: 'Click "Share" in Zoom to share your screen.',
  },
  {
    id: 'mute-av',
    image: zoomAudioVideo,
    alt: 'Zoom toolbar with Audio and Video buttons highlighted',
    label: 'Mute your audio and turn off your video in Zoom.',
  },
];

const SetupGuide = () => {
  const [checked, setChecked] = useState(() => STEPS.map(() => false));
  const navigate = useNavigate();

  const toggle = (index) => {
    setChecked((prev) => prev.map((val, i) => (i === index ? !val : val)));
  };

  const allChecked = checked.every(Boolean);

  return (
    <Container className="d-flex align-items-center justify-content-center min-vh-100">
      <Card className="shadow-lg" style={{ width: '100%', maxWidth: '900px' }}>
        <Card.Header className="bg-primary text-white text-center">
          <h4 className="mb-0">Before You Start</h4>
        </Card.Header>
        <Card.Body className="p-4">
          <p className="text-center text-muted mb-4">
            Please complete the following steps in Zoom before continuing.
          </p>

          {STEPS.map((step, index) => (
            <div key={step.id} className="mb-4 border rounded p-3">
              <img
                src={step.image}
                alt={step.alt}
                className="rounded mb-3"
                style={{
                  width: '100%',
                  height: '160px',
                  objectFit: 'contain',
                  backgroundColor: '#1c1c1c',
                }}
              />
              <Form.Check
                type="checkbox"
                id={`step-${step.id}`}
                label={step.label}
                checked={checked[index]}
                onChange={() => toggle(index)}
              />
            </div>
          ))}

          <div className="d-grid mt-2">
            <Button
              variant="primary"
              size="lg"
              disabled={!allChecked}
              onClick={() => navigate('/device-check')}
            >
              Next
            </Button>
          </div>
        </Card.Body>
      </Card>
    </Container>
  );
};

export default SetupGuide;
