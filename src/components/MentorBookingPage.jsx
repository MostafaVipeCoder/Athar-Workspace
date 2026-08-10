import React, { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import { Calendar, Clock, CheckCircle, XCircle, ChevronLeft } from 'lucide-react';
import { getMentorById, getAvailableSlots, createBooking } from '../lib/mentorBooking';
import LazyImage from './LazyImage';
import { getGoogleDriveFallbackUrls } from '../lib/utils';

export default function MentorBookingPage() {
  const { mentorId } = useParams();
  const [mentor, setMentor] = useState(null);
  const [slots, setSlots] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedSlot, setSelectedSlot] = useState(null);
  const [showForm, setShowForm] = useState(false);
  const [bookingSuccess, setBookingSuccess] = useState(false);
  const [bookingLoading, setBookingLoading] = useState(false);
  const [formData, setFormData] = useState({ company_name: '', booker_email: '' });

  useEffect(() => {
    loadMentorAndSlots();
  }, [mentorId]);

  const loadMentorAndSlots = async () => {
    try {
      setLoading(true);
      const mentorData = await getMentorById(mentorId);
      const slotsData = await getAvailableSlots(mentorData.event_id, mentorId);
      setMentor(mentorData);
      setSlots(slotsData);
    } catch (error) {
      console.error('Error loading data:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleSelectSlot = (slot) => {
    setSelectedSlot(slot);
    setShowForm(true);
  };

  const handleSubmitBooking = async (e) => {
    e.preventDefault();
    setBookingLoading(true);
    try {
      await createBooking({
        slot_id: selectedSlot.id,
        mentor_id: mentorId,
        event_id: mentor.event_id,
        ...formData
      });
      setBookingSuccess(true);
    } catch (error) {
      alert('Booking failed: ' + error.message);
    } finally {
      setBookingLoading(false);
    }
  };

  const groupSlotsByDate = () => {
    const grouped = {};
    slots.forEach((slot) => {
      const dateKey = new Date(slot.start_time).toDateString();
      if (!grouped[dateKey]) {
        grouped[dateKey] = [];
      }
      grouped[dateKey].push(slot);
    });
    return grouped;
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 flex items-center justify-center p-6">
        <div className="text-center">
          <div className="w-16 h-16 border-4 border-blue-100 border-t-blue-600 rounded-full animate-spin mx-auto mb-4"></div>
          <p className="text-lg font-bold text-gray-700">Loading...</p>
        </div>
      </div>
    );
  }

  if (!mentor) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 flex items-center justify-center p-6">
        <div className="text-center bg-white rounded-2xl shadow-xl p-10 max-w-md">
          <XCircle className="w-20 h-20 text-red-500 mx-auto mb-6" />
          <h2 className="text-2xl font-bold text-gray-900 mb-2">Mentor Not Found</h2>
          <p className="text-gray-600 mb-6">The mentor you're looking for doesn't exist or has been removed.</p>
        </div>
      </div>
    );
  }

  if (bookingSuccess) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 flex items-center justify-center p-6">
        <div className="text-center bg-white rounded-2xl shadow-xl p-10 max-w-md">
          <CheckCircle className="w-20 h-20 text-green-500 mx-auto mb-6" />
          <h2 className="text-2xl font-bold text-gray-900 mb-2">Booking Confirmed!</h2>
          <p className="text-gray-600 mb-6">Your session with {mentor.name} has been booked successfully. You'll receive a confirmation email shortly.</p>
        </div>
      </div>
    );
  }

  if (showForm) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 p-6">
        <div className="max-w-lg mx-auto">
          <button
            onClick={() => setShowForm(false)}
            className="flex items-center gap-2 text-gray-600 hover:text-gray-900 mb-6"
          >
            <ChevronLeft size={20} />
            Back to slots
          </button>

          <div className="bg-white rounded-2xl shadow-xl p-8">
            <h2 className="text-2xl font-bold text-gray-900 mb-2">Confirm Your Booking</h2>
            <p className="text-gray-600 mb-8">Please fill in your details to complete the booking</p>

            <div className="bg-blue-50 rounded-xl p-4 mb-8">
              <div className="flex items-center gap-3 mb-2">
                <div className="w-12 h-12 rounded-full flex items-center justify-center overflow-hidden">
                  <LazyImage
                    src={mentor.photo_url ? getGoogleDriveFallbackUrls(mentor.photo_url)[0] : null}
                    urls={mentor.photo_url ? getGoogleDriveFallbackUrls(mentor.photo_url) : []}
                    alt={mentor.name}
                    objectFit="cover"
                    className="w-full h-full"
                    fallback={
                      <div className="w-full h-full flex items-center justify-center bg-blue-600 text-white font-bold text-lg">
                        {mentor.name.charAt(0)}
                      </div>
                    }
                  />
                </div>
                <div>
                  <h3 className="font-bold text-gray-900">{mentor.name}</h3>
                  <p className="text-sm text-gray-600">{mentor.email}</p>
                </div>
              </div>
              <div className="flex items-center gap-2 text-sm text-gray-700 mt-3">
                <Calendar size={16} />
                <span>{new Date(selectedSlot.start_time).toLocaleDateString('en-US', {
                  weekday: 'long',
                  year: 'numeric',
                  month: 'long',
                  day: 'numeric'
                })}</span>
              </div>
              <div className="flex items-center gap-2 text-sm text-gray-700">
                <Clock size={16} />
                <span>
                  {new Date(selectedSlot.start_time).toLocaleTimeString('en-US', {
                    hour: '2-digit',
                    minute: '2-digit'
                  })} - {new Date(selectedSlot.end_time).toLocaleTimeString('en-US', {
                    hour: '2-digit',
                    minute: '2-digit'
                  })}
                </span>
              </div>
            </div>

            <form onSubmit={handleSubmitBooking}>
              <div className="mb-6">
                <label className="block text-gray-700 font-medium mb-2">Company Name</label>
                <input
                  type="text"
                  value={formData.company_name}
                  onChange={(e) => setFormData({ ...formData, company_name: e.target.value })}
                  className="w-full border border-gray-300 rounded-xl px-4 py-3 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-all"
                  placeholder="Enter your company name"
                  required
                />
              </div>

              <div className="mb-8">
                <label className="block text-gray-700 font-medium mb-2">Email Address</label>
                <input
                  type="email"
                  value={formData.booker_email}
                  onChange={(e) => setFormData({ ...formData, booker_email: e.target.value })}
                  className="w-full border border-gray-300 rounded-xl px-4 py-3 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-all"
                  placeholder="your@email.com"
                  required
                />
              </div>

              <button
                type="submit"
                disabled={bookingLoading}
                className="w-full bg-blue-600 text-white font-bold py-4 rounded-xl hover:bg-blue-700 transition-colors disabled:opacity-70 disabled:cursor-not-allowed flex items-center justify-center gap-2"
              >
                {bookingLoading ? (
                  <>
                    <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                    جاري تاكيد الحجز...
                  </>
                ) : (
                  'Confirm Booking'
                )}
              </button>
            </form>
          </div>
        </div>
      </div>
    );
  }

  const groupedSlots = groupSlotsByDate();

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 p-6">
      <div className="max-w-4xl mx-auto">
        <div className="text-center mb-10">
          <div className="w-24 h-24 rounded-full flex items-center justify-center mx-auto mb-4 shadow-lg overflow-hidden">
            <LazyImage
              src={mentor.photo_url ? getGoogleDriveFallbackUrls(mentor.photo_url)[0] : null}
              urls={mentor.photo_url ? getGoogleDriveFallbackUrls(mentor.photo_url) : []}
              alt={mentor.name}
              objectFit="cover"
              className="w-full h-full"
              fallback={
                <div className="w-full h-full flex items-center justify-center bg-gradient-to-br from-blue-600 to-indigo-600 text-white font-bold text-3xl">
                  {mentor.name.charAt(0)}
                </div>
              }
            />
          </div>
          <h1 className="text-3xl font-bold text-gray-900 mb-2">Book a Session with {mentor.name}</h1>
          <p className="text-gray-600">Select an available time slot below</p>
        </div>

        <div className="bg-white rounded-2xl shadow-xl p-8">
          {Object.keys(groupedSlots).length === 0 ? (
            <div className="text-center py-12">
              <Calendar className="w-16 h-16 text-gray-300 mx-auto mb-4" />
              <h3 className="text-xl font-bold text-gray-700 mb-2">No Slots Available</h3>
              <p className="text-gray-500">There are no available time slots at the moment. Please check back later.</p>
            </div>
          ) : (
            <div className="space-y-8">
              {Object.keys(groupedSlots).sort((a, b) => new Date(a) - new Date(b)).map((dateKey) => (
                <div key={dateKey}>
                  <h3 className="text-lg font-bold text-gray-800 mb-4 flex items-center gap-2">
                    <Calendar size={20} />
                    {new Date(dateKey).toLocaleDateString('en-US', {
                      weekday: 'long',
                      year: 'numeric',
                      month: 'long',
                      day: 'numeric'
                    })}
                  </h3>
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                    {groupedSlots[dateKey].map((slot) => (
                      <button
                        key={slot.id}
                        onClick={() => handleSelectSlot(slot)}
                        className="border-2 border-gray-200 rounded-xl p-4 hover:border-blue-500 hover:bg-blue-50 transition-all text-left"
                      >
                        <div className="flex items-center gap-2 text-blue-600 font-semibold mb-1">
                          <Clock size={16} />
                          <span>
                            {new Date(slot.start_time).toLocaleTimeString('en-US', {
                              hour: '2-digit',
                              minute: '2-digit'
                            })}
                          </span>
                          <span className="text-gray-400"> - </span>
                          <span>
                            {new Date(slot.end_time).toLocaleTimeString('en-US', {
                              hour: '2-digit',
                              minute: '2-digit'
                            })}
                          </span>
                        </div>
                        <p className="text-sm text-gray-500">Click to book</p>
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
